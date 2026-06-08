import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import type { Cluster, Redis as RedisClient } from 'ioredis';
import type {
  ConnectionSummary,
  KeyPreview,
  KeySummary,
  ConsoleCommandRequest,
  ConsoleCommandResult,
  RedisConnectionConfig,
  ScanKeysRequest,
  ScanKeysResult,
  SetKeyRequest
} from '../shared/types';
import { SshTunnelManager, type TunnelHandle } from './ssh-tunnel';

type RedisInstance = RedisClient | Cluster;

type ConnectionRecord = {
  id: string;
  config: RedisConnectionConfig;
  client: RedisInstance;
  tunnel?: TunnelHandle;
};

export class RedisService {
  private readonly connections = new Map<string, ConnectionRecord>();
  private readonly tunnels = new SshTunnelManager();

  async connect(config: RedisConnectionConfig): Promise<ConnectionSummary> {
    const id = randomUUID();
    const endpoints = config.endpoints.length > 0 ? config.endpoints : [{ host: '127.0.0.1', port: 6379 }];
    let activeEndpoints = endpoints;
    let tunnel: TunnelHandle | undefined;

    if (config.sshTunnel?.enabled) {
      const first = endpoints[0];
      tunnel = await this.tunnels.open(config.sshTunnel, first.host, first.port);
      activeEndpoints = [{ host: tunnel.localHost, port: tunnel.localPort }];
    }

    const client = this.createClient(config, activeEndpoints);
    const record: ConnectionRecord = { id, config, client, tunnel };

    try {
      await withTimeout(client.ping(), 8_000, 'Redis connection timed out after 8 seconds. Check the Redis host, port, SSH tunnel, and auth.');
      this.connections.set(id, record);
      return await this.summarize(record);
    } catch (error) {
      await tunnel?.close();
      client.disconnect();
      throw new Error(buildConnectErrorMessage(config, activeEndpoints, error));
    }
  }

  async disconnect(connectionId: string): Promise<void> {
    const record = this.get(connectionId);
    this.connections.delete(connectionId);
    record.client.disconnect();
    await record.tunnel?.close();
  }

  async testConnection(config: RedisConnectionConfig): Promise<ConnectionSummary> {
    let summary: ConnectionSummary | undefined;
    try {
      summary = await this.connect(config);
      return summary;
    } finally {
      if (summary) {
        await this.disconnect(summary.id).catch(() => undefined);
      }
    }
  }

  async ping(connectionId: string): Promise<string> {
    return this.get(connectionId).client.ping();
  }

  async scanKeys(request: ScanKeysRequest): Promise<ScanKeysResult> {
    const record = this.get(request.connectionId);
    if (record.config.mode === 'cluster' && 'nodes' in record.client) {
      return this.scanCluster(record.client, request);
    }
    return this.scanRedis(record.client as RedisClient, request);
  }

  async previewKey(connectionId: string, key: string): Promise<KeyPreview> {
    const client = this.get(connectionId).client;
    const type = await client.type(key);
    const ttl = await client.ttl(key);

    switch (type) {
      case 'string': {
        return { key, type, ttl, value: await client.get(key) };
      }
      case 'hash': {
        const [cursor, items] = await client.hscan(key, '0', 'COUNT', 100);
        return { key, type, ttl, size: await client.hlen(key), value: { cursor, items: pairList(items) } };
      }
      case 'list': {
        return { key, type, ttl, size: await client.llen(key), value: await client.lrange(key, 0, 99) };
      }
      case 'set': {
        const [cursor, items] = await client.sscan(key, '0', 'COUNT', 100);
        return { key, type, ttl, size: await client.scard(key), value: { cursor, items } };
      }
      case 'zset': {
        return {
          key,
          type,
          ttl,
          size: await client.zcard(key),
          value: await client.zrange(key, 0, 99, 'WITHSCORES')
        };
      }
      case 'stream': {
        return {
          key,
          type,
          ttl,
          size: await client.xlen(key),
          value: await client.xrevrange(key, '+', '-', 'COUNT', 100)
        };
      }
      default:
        return { key, type, ttl, value: null };
    }
  }

  async deleteKey(connectionId: string, key: string): Promise<number> {
    return this.get(connectionId).client.del(key);
  }

  async setKey(request: SetKeyRequest): Promise<void> {
    const client = this.get(request.connectionId).client;

    switch (request.type) {
      case 'string':
        await client.set(request.key, String(request.value));
        break;
      case 'hash':
        await client.del(request.key);
        if (Object.keys(request.value as Record<string, string>).length > 0) {
          await client.hset(request.key, request.value as Record<string, string>);
        }
        break;
      case 'list':
        await client.del(request.key);
        if ((request.value as string[]).length > 0) {
          await client.rpush(request.key, ...(request.value as string[]));
        }
        break;
      case 'set':
        await client.del(request.key);
        if ((request.value as string[]).length > 0) {
          await client.sadd(request.key, ...(request.value as string[]));
        }
        break;
      case 'zset':
        await client.del(request.key);
        if ((request.value as string[]).length > 0) {
          await client.zadd(request.key, ...(request.value as string[]));
        }
        break;
    }

    if (request.ttl !== null && request.ttl !== undefined && request.ttl > 0) {
      await client.expire(request.key, request.ttl);
    }
  }

  async setKeyTtl(connectionId: string, key: string, ttl: number | null): Promise<void> {
    const client = this.get(connectionId).client;
    if (ttl !== null && ttl > 0) {
      await client.expire(key, ttl);
      return;
    }
    await client.persist(key);
  }

  async setHashField(connectionId: string, key: string, field: string, value: string): Promise<void> {
    await this.get(connectionId).client.hset(key, field, value);
  }

  async runCommand(request: ConsoleCommandRequest): Promise<ConsoleCommandResult> {
    const client = this.get(request.connectionId).client;
    const parts = parseCommand(request.command);
    if (parts.length === 0) {
      throw new Error('Command is required.');
    }

    const [command, ...args] = parts;
    return { value: await client.call(command, ...args) };
  }

  private createClient(config: RedisConnectionConfig, endpoints: RedisConnectionConfig['endpoints']): RedisInstance {
    const baseOptions = {
      username: config.username || undefined,
      password: config.password || undefined,
      db: config.database ?? 0,
      tls: config.tls ? {} : undefined,
      lazyConnect: true,
      connectTimeout: 8_000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => undefined
    };

    if (config.mode === 'cluster') {
      return new Redis.Cluster(endpoints, {
        redisOptions: baseOptions,
        clusterRetryStrategy: () => undefined,
        scaleReads: 'slave'
      });
    }

    return new Redis({
      ...baseOptions,
      host: endpoints[0].host,
      port: endpoints[0].port
    });
  }

  private async summarize(record: ConnectionRecord): Promise<ConnectionSummary> {
    const address = record.config.endpoints.map((endpoint) => `${endpoint.host}:${endpoint.port}`).join(', ');
    const info = await record.client.info().catch(() => '');
    const dbSize = await record.client.dbsize().catch(() => undefined);
    const redisVersion = info.match(/^redis_version:(.+)$/m)?.[1]?.trim();

    return {
      id: record.id,
      name: record.config.name,
      mode: record.config.mode,
      address,
      redisVersion,
      dbSize
    };
  }

  private async scanRedis(client: RedisClient, request: ScanKeysRequest): Promise<ScanKeysResult> {
    const [cursor, keys] = await client.scan(request.cursor || '0', 'MATCH', request.pattern || '*', 'COUNT', request.count ?? 100);
    return { cursor, keys: await this.describeKeys(client, keys) };
  }

  private async scanCluster(client: Cluster, request: ScanKeysRequest): Promise<ScanKeysResult> {
    const masters = client.nodes('master');
    const keys: KeySummary[] = [];
    const cursors = parseClusterCursor(request.cursor);
    const nextCursors: Record<string, string> = {};

    await Promise.all(
      masters.map(async (node) => {
        const nodeId = `${node.options.host}:${node.options.port}`;
        const [cursor, nodeKeys] = await node.scan(cursors[nodeId] ?? '0', 'MATCH', request.pattern || '*', 'COUNT', String(request.count ?? 50));
        const described = await this.describeKeys(node, nodeKeys);
        described.forEach((item) => keys.push({ ...item, node: nodeId }));
        nextCursors[nodeId] = cursor;
      })
    );

    const hasMore = Object.values(nextCursors).some((cursor) => cursor !== '0');
    return { cursor: hasMore ? JSON.stringify(nextCursors) : '0', keys };
  }

  private async describeKeys(client: RedisClient, keys: string[]): Promise<KeySummary[]> {
    if (keys.length === 0) {
      return [];
    }

    const pipeline = client.pipeline();
    keys.forEach((key) => {
      pipeline.type(key);
      pipeline.ttl(key);
    });
    const result = await pipeline.exec();

    return keys.map((key, index) => ({
      key,
      type: String(result?.[index * 2]?.[1] ?? 'unknown'),
      ttl: Number(result?.[index * 2 + 1]?.[1] ?? -1)
    }));
  }

  private get(connectionId: string): ConnectionRecord {
    const record = this.connections.get(connectionId);
    if (!record) {
      throw new Error(`Redis connection not found: ${connectionId}`);
    }
    return record;
  }
}

function pairList(items: string[]): Record<string, string> {
  const output: Record<string, string> = {};
  for (let index = 0; index < items.length; index += 2) {
    output[items[index]] = items[index + 1];
  }
  return output;
}

function parseClusterCursor(cursor: string | undefined): Record<string, string> {
  if (!cursor || cursor === '0') {
    return {};
  }
  try {
    const parsed = JSON.parse(cursor) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .map(([node, nodeCursor]) => [node, nodeCursor])
    );
  } catch {
    return {};
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timer));
  });
}

function buildConnectErrorMessage(config: RedisConnectionConfig, activeEndpoints: RedisConnectionConfig['endpoints'], error: unknown): string {
  const target = activeEndpoints.map((endpoint) => `${endpoint.host}:${endpoint.port}`).join(', ');
  const original = formatErrorMessage(error);

  if (original.includes('ENOTFOUND')) {
    const configured = config.endpoints.map((endpoint) => `${endpoint.host}:${endpoint.port}`).join(', ');
    if (config.sshTunnel?.enabled) {
      return `Unable to resolve Redis host through SSH tunnel. Redis target is "${configured}", local tunnel is "${target}". Check that the Redis host is reachable from the SSH server. Original error: ${original}`;
    }
    return `Unable to resolve Redis host "${configured}". Check the Redis host/IP or your DNS/VPN. Original error: ${original}`;
  }

  return `Unable to connect to Redis at "${target}": ${original}`;
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function parseCommand(command: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let escaped = false;

  for (const char of command.trim()) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }

  if (quote) {
    throw new Error('Unclosed quote in command.');
  }
  if (current) {
    parts.push(current);
  }
  return parts;
}

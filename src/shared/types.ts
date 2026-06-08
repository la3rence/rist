export type ConnectionMode = 'single' | 'cluster';

export type SshTunnelConfig = {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  privateKeyPath?: string;
  passphrase?: string;
};

export type RedisEndpoint = {
  host: string;
  port: number;
};

export type RedisConnectionConfig = {
  id?: string;
  name: string;
  color?: string;
  mode: ConnectionMode;
  endpoints: RedisEndpoint[];
  username?: string;
  password?: string;
  database?: number;
  tls?: boolean;
  sshTunnel?: SshTunnelConfig;
};

export type SavedConnections = {
  selectedId?: string;
  connections: RedisConnectionConfig[];
};

export type ConnectionSummary = {
  id: string;
  name: string;
  mode: ConnectionMode;
  address: string;
  redisVersion?: string;
  dbSize?: number;
};

export type KeySummary = {
  key: string;
  type: string;
  ttl: number;
  node?: string;
};

export type ScanKeysRequest = {
  connectionId: string;
  cursor?: string;
  pattern?: string;
  count?: number;
};

export type ScanKeysResult = {
  cursor: string;
  keys: KeySummary[];
};

export type KeyPreview = {
  key: string;
  type: string;
  ttl: number;
  size?: number;
  value: unknown;
};

export type SetKeyRequest = {
  connectionId: string;
  key: string;
  type: 'string' | 'hash' | 'list' | 'set' | 'zset';
  value: unknown;
  ttl?: number | null;
};

export type SetKeyTtlRequest = {
  connectionId: string;
  key: string;
  ttl: number | null;
};

export type SetHashFieldRequest = {
  connectionId: string;
  key: string;
  field: string;
  value: string;
};

export type ConsoleCommandRequest = {
  connectionId: string;
  command: string;
};

export type ConsoleCommandResult = {
  value: unknown;
};

export type RedisGuiApi = {
  platform: string;
  openSettings(): Promise<void>;
  loadConnections(): Promise<SavedConnections | undefined>;
  saveConnections(config: SavedConnections): Promise<void>;
  connect(config: RedisConnectionConfig): Promise<ConnectionSummary>;
  testConnection(config: RedisConnectionConfig): Promise<ConnectionSummary>;
  disconnect(connectionId: string): Promise<void>;
  scanKeys(request: ScanKeysRequest): Promise<ScanKeysResult>;
  previewKey(connectionId: string, key: string): Promise<KeyPreview>;
  deleteKey(connectionId: string, key: string): Promise<number>;
  setKey(request: SetKeyRequest): Promise<void>;
  setKeyTtl(request: SetKeyTtlRequest): Promise<void>;
  setHashField(request: SetHashFieldRequest): Promise<void>;
  runCommand(request: ConsoleCommandRequest): Promise<ConsoleCommandResult>;
  ping(connectionId: string): Promise<string>;
};

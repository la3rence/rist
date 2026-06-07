import { createServer, type Server, type Socket } from 'node:net';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { Client, type ConnectConfig } from 'ssh2';
import type { SshTunnelConfig } from '../shared/types';

export type TunnelHandle = {
  localHost: string;
  localPort: number;
  close(): Promise<void>;
};

export class SshTunnelManager {
  async open(config: SshTunnelConfig, targetHost: string, targetPort: number): Promise<TunnelHandle> {
    this.validateConfig(config);

    const ssh = new Client();
    const localHost = '127.0.0.1';
    const privateKey = await this.loadPrivateKey(config);
    const sshConfig: ConnectConfig = {
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      privateKey,
      passphrase: config.passphrase,
      readyTimeout: 15_000
    };

    try {
      await new Promise<void>((resolve, reject) => {
        ssh.once('ready', resolve);
        ssh.once('error', reject);
        ssh.connect(sshConfig);
      });
    } catch (error) {
      throw new Error(`Unable to connect to SSH host "${config.host}:${config.port}": ${formatErrorMessage(error)}`);
    }

    const server = createServer((socket) => {
      this.forwardSocket(ssh, socket, targetHost, targetPort);
    });

    const localPort = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, localHost, () => {
        const address = server.address();
        if (typeof address === 'object' && address) {
          resolve(address.port);
          return;
        }
        reject(new Error('Unable to allocate local SSH tunnel port.'));
      });
    });

    return {
      localHost,
      localPort,
      close: async () => {
        await closeServer(server);
        ssh.end();
      }
    };
  }

  private validateConfig(config: SshTunnelConfig): void {
    if (!config.host.trim()) {
      throw new Error('SSH tunnel host is required.');
    }
    if (!config.username.trim()) {
      throw new Error('SSH tunnel username is required.');
    }
    if (!Number.isInteger(config.port) || config.port <= 0 || config.port > 65535) {
      throw new Error('SSH tunnel port must be between 1 and 65535.');
    }
    if (!config.password && !config.privateKey && !config.privateKeyPath) {
      throw new Error('SSH tunnel requires a password, private key, or private key path.');
    }
  }

  private async loadPrivateKey(config: SshTunnelConfig): Promise<string | undefined> {
    if (config.privateKeyPath?.trim()) {
      const path = expandHomePath(config.privateKeyPath.trim());
      try {
        return await readFile(path, 'utf8');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Unable to read SSH private key file: ${message}`);
      }
    }
    return config.privateKey;
  }

  private forwardSocket(ssh: Client, socket: Socket, targetHost: string, targetPort: number): void {
    ssh.forwardOut(
      socket.remoteAddress ?? '127.0.0.1',
      socket.remotePort ?? 0,
      targetHost,
      targetPort,
      (error, stream) => {
        if (error) {
          socket.destroy(error);
          return;
        }
        socket.pipe(stream).pipe(socket);
      }
    );
  }
}

function expandHomePath(path: string): string {
  if (path === '~') {
    return homedir();
  }
  if (path.startsWith('~/')) {
    return `${homedir()}${path.slice(1)}`;
  }
  return path;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

import { serve, type ServerType } from '@hono/node-server';
import { getLogger } from '@agent/shared';
import { buildApp } from './app.js';
import type { ServerState } from './types.js';

export * from './auth.js';
export * from './types.js';

const log = getLogger('server');

export interface StartServerOptions {
  state: ServerState;
  /** Port to bind. Defaults to 23456. If in use, will try N+1 up to 10 times. */
  port?: number;
  /** Host to bind. Always 127.0.0.1 — do not change. */
  hostname?: '127.0.0.1';
}

export interface RunningServer {
  port: number;
  url: string;
  stop(): Promise<void>;
}

/**
 * Start the local Hono server on 127.0.0.1. Refuses to bind to any other
 * interface — the web app is strictly a local oversight tool.
 */
export async function startServer(opts: StartServerOptions): Promise<RunningServer> {
  const app = buildApp(opts.state);
  const hostname = opts.hostname ?? '127.0.0.1';
  const startPort = opts.port ?? 23456;

  for (let p = startPort; p < startPort + 10; p++) {
    try {
      const server: ServerType = serve({ fetch: app.fetch, port: p, hostname });
      const url = `http://${hostname}:${p}`;
      log.info({ url }, 'server.started');
      return {
        port: p,
        url,
        async stop() {
          await new Promise<void>((resolve, reject) =>
            server.close((err) => (err ? reject(err) : resolve())),
          );
        },
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE') continue;
      throw e;
    }
  }
  throw new Error(`No free port in range ${startPort}..${startPort + 9}`);
}

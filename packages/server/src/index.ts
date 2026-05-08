import { serve, type ServerType } from '@hono/node-server';
import { getLogger } from '@agent/shared';
import { buildApp } from './app.js';
import type { ServerState } from './types.js';

export * from './auth.js';
export * from './types.js';
export * from './remote-approver.js';

const log = getLogger('server');

export interface StartServerOptions {
  state: ServerState;
  /** Port to bind. Defaults to 23456. If in use, will try N+1 up to 10 times. */
  port?: number;
  /** Host to bind. Defaults to '127.0.0.1'. Pass '0.0.0.0' only for container deploys where the token is the sole defence. */
  hostname?: string;
  /** Chat runner (standalone runtime only). Enables POST /api/chat. */
  runTurn?: (message: string, signal: AbortSignal) => Promise<{ text: string }>;
}

export interface RunningServer {
  port: number;
  url: string;
  stop(): Promise<void>;
}

/**
 * Start the Hono server. Defaults to 127.0.0.1 — the VS Code extension path.
 * Pass `hostname: '0.0.0.0'` from the standalone runtime (apps/agent-runtime)
 * when running inside a container; the bearer token is then the sole defence.
 */
export async function startServer(opts: StartServerOptions): Promise<RunningServer> {
  const app = buildApp(opts.state, { ...(opts.runTurn ? { runTurn: opts.runTurn } : {}) });
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

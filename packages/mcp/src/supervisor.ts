import { getLogger } from '@agent/shared';
import { McpClient, type McpToolSchema } from './client.js';
import type { McpConfig, McpServerConfig } from './config.js';

const log = getLogger('mcp-supervisor');

/**
 * Resolve env vars for an MCP server: literal `env` entries, merged with the
 * keys listed in `envKeys` pulled from the host environment (or a provided
 * secrets map).
 */
export function resolveServerEnv(
  server: McpServerConfig,
  secrets: Record<string, string | undefined>,
  hostEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = {
    PATH: hostEnv['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: hostEnv['HOME'] ?? '',
    LANG: hostEnv['LANG'] ?? 'en_US.UTF-8',
    LC_ALL: hostEnv['LC_ALL'] ?? 'en_US.UTF-8',
  };
  for (const k of server.envKeys) {
    const v = secrets[k] ?? hostEnv[k];
    if (typeof v === 'string' && v.length > 0) base[k] = v;
  }
  for (const [k, v] of Object.entries(server.env)) base[k] = v;
  return base;
}

export interface RunningServer {
  name: string;
  client: McpClient;
  tools: McpToolSchema[];
}

export interface SupervisorOptions {
  config: McpConfig;
  /** Secrets keyed by env var name, typically from VS Code SecretStorage. */
  secrets?: Record<string, string | undefined>;
}

/**
 * Manages the lifecycle of N MCP servers. `start()` spawns every enabled
 * server, retrieves its tool list, and caches it. Failures on one server do
 * NOT stop the others — the supervisor continues with whatever succeeded.
 */
export class McpSupervisor {
  private running = new Map<string, RunningServer>();
  private stopping = false;

  constructor(private readonly opts: SupervisorOptions) {}

  async start(): Promise<void> {
    const secrets = this.opts.secrets ?? {};
    const tasks = this.opts.config.servers
      .filter((s) => s.enabled)
      .map(async (server) => {
        const env = resolveServerEnv(server, secrets);
        const client = new McpClient(server, env);
        try {
          await client.connect();
          const tools = await client.listTools();
          this.running.set(server.name, { name: server.name, client, tools });
          log.info({ server: server.name, toolCount: tools.length }, 'mcp.supervisor.server.ready');
        } catch (e) {
          log.error(
            { server: server.name, err: (e as Error).message },
            'mcp.supervisor.server.start.failed',
          );
          await client.close().catch(() => {});
        }
      });
    await Promise.allSettled(tasks);
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    const entries = [...this.running.values()];
    this.running.clear();
    await Promise.allSettled(entries.map((s) => s.client.close()));
  }

  /** All tools across all running servers, with the server's config attached. */
  allTools(): Array<{ server: McpServerConfig; tool: McpToolSchema; client: McpClient }> {
    const byName = new Map<string, McpServerConfig>();
    for (const s of this.opts.config.servers) byName.set(s.name, s);
    const out: Array<{ server: McpServerConfig; tool: McpToolSchema; client: McpClient }> = [];
    for (const running of this.running.values()) {
      const cfg = byName.get(running.name);
      if (!cfg) continue;
      for (const tool of running.tools) {
        out.push({ server: cfg, tool, client: running.client });
      }
    }
    return out;
  }

  isRunning(name: string): boolean {
    return this.running.has(name);
  }
}

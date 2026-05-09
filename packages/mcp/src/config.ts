import * as fs from 'node:fs/promises';
import { z } from 'zod';

/**
 * Configuration schema for `mcp.config.json`. Describes which MCP servers the
 * agent should spawn, how to launch them, and optional per-server tool tier
 * overrides (e.g. surface `context7__query-docs` at tier 0 but `patch-page`
 * at tier 3, regardless of the auto-heuristic).
 */
export const McpServerConfigSchema = z.object({
  name: z.string().min(1).describe('Unique server name. Tools surface as mcp__<name>__<tool>.'),
  enabled: z.boolean().optional().default(true),
  transport: z.enum(['stdio']).optional().default('stdio'),
  command: z.string().min(1).describe('Executable to spawn (e.g. "npx").'),
  args: z.array(z.string()).optional().default([]),
  /** Env var names to pull from the host environment / SecretStorage. */
  envKeys: z.array(z.string()).optional().default([]),
  /** Literal env entries injected into the subprocess (non-secret). */
  env: z.record(z.string(), z.string()).optional().default({}),
  /**
   * Per-tool tier overrides. Keyed by bare tool name (without the
   * `mcp__<server>__` prefix). Values are 0..6.
   */
  tierOverrides: z.record(z.string(), z.number().int().min(0).max(6)).optional().default({}),
  /** Default tier for any tool on this server that isn't matched by overrides or heuristics. */
  defaultTier: z.number().int().min(0).max(6).optional(),
  /** Retry/backoff caps. */
  startupTimeoutMs: z.number().int().min(1_000).max(60_000).optional().default(15_000),
  maxReconnects: z.number().int().min(0).max(20).optional().default(5),
});
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export const McpConfigSchema = z.object({
  servers: z.array(McpServerConfigSchema).default([]),
});
export type McpConfig = z.infer<typeof McpConfigSchema>;

export async function loadMcpConfig(path: string): Promise<McpConfig> {
  const raw = await fs.readFile(path, 'utf8');
  const json = JSON.parse(raw) as unknown;
  return McpConfigSchema.parse(json);
}

/**
 * Fallback MCP config used when the workspace has no `mcp.config.json`.
 * Seeded with sequential-thinking and Context7 so the agent has useful tools
 * out-of-the-box. Projects override by dropping their own `mcp.config.json`
 * at the workspace root.
 */
export const DEFAULT_MCP_CONFIG: McpConfig = McpConfigSchema.parse({
  servers: [
    {
      name: 'sequential-thinking',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
      defaultTier: 0,
    },
    {
      name: 'context7',
      command: 'npx',
      args: ['-y', '@upstash/context7-mcp'],
      envKeys: ['CONTEXT7_API_KEY'],
      defaultTier: 0,
    },
    {
      name: 'chrome-devtools',
      command: 'npx',
      args: ['-y', 'chrome-devtools-mcp@latest'],
      defaultTier: 3,
      startupTimeoutMs: 30_000,
    },
  ],
});

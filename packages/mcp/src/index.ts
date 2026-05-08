export * from './config.js';
export * from './tier-heuristic.js';
export * from './client.js';
export * from './supervisor.js';
export * from './tool-adapter.js';

import type { ToolRegistry } from '@agent/tools';
import type { McpSupervisor } from './supervisor.js';
import { toolFromMcp } from './tool-adapter.js';

/**
 * Register every tool exposed by every running MCP server into `registry`.
 * Idempotent for a given supervisor — caller should only call this once.
 */
export function registerMcpTools(registry: ToolRegistry, supervisor: McpSupervisor): void {
  for (const { server, tool, client } of supervisor.allTools()) {
    const def = toolFromMcp(server, tool, client);
    if (!registry.has(def.name)) {
      registry.register(def);
    }
  }
}

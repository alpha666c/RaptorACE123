import { z } from 'zod';
import type { ToolDef } from '@agent/tools';
import type { McpClient, McpToolSchema } from './client.js';
import type { McpServerConfig } from './config.js';
import { inferTier } from './tier-heuristic.js';

/**
 * Convert an MCP tool into an agent `ToolDef`. The tool is registered in the
 * registry under `mcp__<server>__<toolName>`, matching Claude Code's naming
 * convention the user already knows. The registry's tier gate and approval
 * flow apply identically to MCP tools as to built-in tools — the model never
 * touches the raw MCP client.
 */
export function toolFromMcp(
  server: McpServerConfig,
  tool: McpToolSchema,
  client: McpClient,
): ToolDef {
  const toolFullName = `mcp__${server.name}__${tool.name}`;
  const minTier = inferTier(tool.name, server);
  const description = formatDescription(server, tool);

  // MCP tools bring their own JSON schema; we use a permissive zod shape for
  // the registry's pre-execute check and pass the original JSON schema through
  // `inputJsonSchema` so the AI SDK can give the model a correctly-typed tool.
  const passThroughZod: z.ZodTypeAny = z.unknown();

  const def: ToolDef = {
    name: toolFullName,
    description,
    minTier,
    parameters: passThroughZod,
    inputJsonSchema: tool.inputSchema,
    async execute(args, ctx) {
      if (ctx.signal.aborted) throw new Error('Aborted');
      const res = await client.callTool(tool.name, args);
      if (!res.ok || res.isError) {
        throw new Error(
          `MCP ${server.name}.${tool.name} failed: ${res.errorMessage ?? stringifyContent(res.content)}`,
        );
      }
      return {
        text: stringifyContent(res.content),
        content: res.content,
        ...(res.structuredContent !== undefined ? { structuredContent: res.structuredContent } : {}),
      };
    },
  };
  return def;
}

export interface McpResult {
  text: string;
  content: Array<{ type: string; text?: string; [k: string]: unknown }>;
  structuredContent?: unknown;
}

function formatDescription(server: McpServerConfig, tool: McpToolSchema): string {
  const base = tool.description || `MCP tool ${tool.name} from ${server.name}`;
  return `[MCP ${server.name}] ${base}`;
}

function stringifyContent(content: Array<{ type: string; text?: string; [k: string]: unknown }>): string {
  return content
    .map((c) => {
      if (c.type === 'text') return c.text ?? '';
      return JSON.stringify(c);
    })
    .join('\n');
}

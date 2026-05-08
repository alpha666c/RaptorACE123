import { jsonSchema, tool, type Tool } from 'ai';
import type { ToolRegistry, RegistryContext } from '@agent/tools';

/** AI SDK tool names allow [a-zA-Z0-9_-]. Our internal names use dots. */
export function sanitizeToolName(internal: string): string {
  return internal.replaceAll('.', '_');
}

/**
 * Build the AI SDK tool map for the model.
 * The model sees ALL tools regardless of tier — the permission gate in the
 * registry handles approval when the model attempts to call a higher-tier tool.
 *
 * Tools that provide `inputJsonSchema` (MCP tools) are surfaced via AI SDK's
 * `jsonSchema()` wrapper so the model sees the original typed schema rather
 * than our permissive pass-through zod shape.
 */
export function buildAiSdkTools(
  registry: ToolRegistry,
  regCtx: RegistryContext,
): Record<string, Tool> {
  const result: Record<string, Tool> = {};
  for (const def of registry.all()) {
    const modelName = sanitizeToolName(def.name);
    const parameters = def.inputJsonSchema
      ? jsonSchema(def.inputJsonSchema)
      : def.parameters;
    result[modelName] = tool({
      description: def.description,
      parameters,
      async execute(args: unknown) {
        const invocation = await registry.execute(def.name, args, regCtx);
        if (!invocation.ok) {
          return { error: invocation.error ?? 'Unknown tool error.', toolName: def.name };
        }
        return invocation.result;
      },
    });
  }
  return result;
}

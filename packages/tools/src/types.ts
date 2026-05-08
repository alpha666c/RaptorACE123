import type { Tier } from '@agent/shared';
import type { z } from 'zod';

/** Context passed to every tool `execute()`. */
export interface ToolContext {
  sessionId: string;
  projectRoots: readonly string[];
  /** Abort signal; tools must respect cancellation. */
  signal: AbortSignal;
}

/**
 * A tool definition. `parameters` is a zod schema; `execute` receives the
 * already-validated typed input. Tools must never reach outside `projectRoots`
 * and must never call approval/permissions themselves — the registry handles that.
 *
 * `TSchema` is the schema type; `TOut` is the execute return type. Input args
 * to `execute` are `z.infer<TSchema>` (i.e. the parsed output, with defaults).
 */
export interface ToolDef<TSchema extends z.ZodTypeAny = z.ZodTypeAny, TOut = unknown> {
  name: string;
  description: string;
  minTier: Tier;
  parameters: TSchema;
  /**
   * Optional raw JSON Schema for the tool's input. Takes precedence over
   * `parameters` when feeding the tool to the LLM. Used for MCP tools whose
   * schema comes from the server as JSON Schema rather than a zod schema.
   * The registry still uses `parameters` for its pre-execute validation.
   */
  inputJsonSchema?: Record<string, unknown>;
  /** Optional preview builder for the approval UI (e.g. a diff). */
  buildPreview?: (
    args: z.infer<TSchema>,
    ctx: ToolContext,
  ) => Promise<{ kind: 'diff' | 'text'; content: string } | undefined>;
  execute: (args: z.infer<TSchema>, ctx: ToolContext) => Promise<TOut>;
}

// biome-ignore lint/suspicious/noExplicitAny: registry stores heterogeneous tools
export type AnyToolDef = ToolDef<z.ZodTypeAny, any>;

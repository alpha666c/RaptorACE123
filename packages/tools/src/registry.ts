import { gateToolCall, type Approver, type SessionPermissionStore } from '@agent/permissions';
import { getLogger, newId, type Tier } from '@agent/shared';
import type { z } from 'zod';
import type { AnyToolDef, ToolContext, ToolDef } from './types.js';

export interface RegistryContext {
  sessionId: string;
  projectRoots: readonly string[];
  session: SessionPermissionStore;
  approver: Approver;
  signal?: AbortSignal;
  onEvent?: (ev: {
    kind: 'tool.call' | 'tool.result' | 'tool.error' | 'permission.request' | 'permission.decided';
    payload: unknown;
  }) => void;
}

export interface ToolInvocationResult {
  callId: string;
  name: string;
  ok: boolean;
  result?: unknown;
  error?: string;
  durationMs: number;
}

/**
 * The single enforcement point for tool execution.
 * EVERY tool call in the system must go through `execute`.
 * This is where zod validation, permission policy, and approval are applied.
 */
export class ToolRegistry {
  private tools = new Map<string, AnyToolDef>();
  private log = getLogger('tool-registry');

  register<TSchema extends z.ZodTypeAny, TOut>(tool: ToolDef<TSchema, TOut>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool ${tool.name} already registered.`);
    }
    this.tools.set(tool.name, tool as unknown as AnyToolDef);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): AnyToolDef | undefined {
    return this.tools.get(name);
  }

  /**
   * All tool definitions visible at or below `maxTier`.
   * Use this to hand the agent its tool list — tools above current tier are hidden.
   */
  availableAt(maxTier: Tier): AnyToolDef[] {
    return [...this.tools.values()].filter((t) => t.minTier <= maxTier);
  }

  all(): AnyToolDef[] {
    return [...this.tools.values()];
  }

  async execute(name: string, rawArgs: unknown, ctx: RegistryContext): Promise<ToolInvocationResult> {
    const callId = newId('call');
    const startedAt = Date.now();
    const tool = this.tools.get(name);

    if (!tool) {
      return { callId, name, ok: false, error: `Unknown tool: ${name}`, durationMs: 0 };
    }

    // 1. Validate args with zod before anything else.
    const parsed = tool.parameters.safeParse(rawArgs);
    if (!parsed.success) {
      const msg = `Invalid arguments for ${name}: ${parsed.error.message}`;
      this.log.warn({ name, error: msg }, 'tool.argvalidate.failed');
      return { callId, name, ok: false, error: msg, durationMs: Date.now() - startedAt };
    }
    const args = parsed.data;

    // 2. Permission gate. May invoke approver.
    const toolCtx: ToolContext = {
      sessionId: ctx.sessionId,
      projectRoots: ctx.projectRoots,
      signal: ctx.signal ?? new AbortController().signal,
    };

    const buildPreview = tool.buildPreview;
    const preview = buildPreview ? await safe(() => buildPreview(args, toolCtx)) : undefined;
    ctx.onEvent?.({ kind: 'tool.call', payload: { callId, name, args } });

    const gate = await gateToolCall(
      {
        toolName: name,
        requiredTier: tool.minTier,
        args,
        ...(preview ? { preview } : {}),
      },
      { sessionId: ctx.sessionId, session: ctx.session },
      ctx.approver,
    );

    if (gate.decision) {
      ctx.onEvent?.({ kind: 'permission.decided', payload: { callId, decision: gate.decision } });
    }

    if (!gate.allowed) {
      const msg = gate.reason ?? 'Denied.';
      ctx.onEvent?.({ kind: 'tool.error', payload: { callId, name, error: msg } });
      return { callId, name, ok: false, error: msg, durationMs: Date.now() - startedAt };
    }

    // 3. Execute.
    try {
      const result = await tool.execute(args, toolCtx);
      const durationMs = Date.now() - startedAt;
      ctx.onEvent?.({ kind: 'tool.result', payload: { callId, name, result, durationMs } });
      return { callId, name, ok: true, result, durationMs };
    } catch (e) {
      const durationMs = Date.now() - startedAt;
      const msg = e instanceof Error ? e.message : String(e);
      this.log.error({ name, error: msg }, 'tool.execute.failed');
      ctx.onEvent?.({ kind: 'tool.error', payload: { callId, name, error: msg } });
      return { callId, name, ok: false, error: msg, durationMs };
    }
  }
}

async function safe<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}

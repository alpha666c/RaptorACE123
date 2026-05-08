import type { MemoryStore } from '@agent/memory';
import type { ModelGateway } from '@agent/model-gateway';
import type { Tier } from '@agent/shared';
import type { ToolRegistry, ToolDef, ToolContext } from '@agent/tools';
import type { SkillManifest } from './manifest.js';

/**
 * Context passed to skills at every hook. Surface enough capabilities for
 * skills to do useful work, without letting them bypass the agent's safety
 * layer: tools still go through `registry.execute`, memory writes still go
 * through the secret scanner, model calls still go through the gateway.
 */
export interface SkillContext {
  sessionId: string;
  projectRoots: readonly string[];
  registry: ToolRegistry;
  memory?: MemoryStore;
  gateway: ModelGateway;
  currentTier: Tier;
  toolContext: ToolContext;
  logger: {
    info: (data: unknown, msg: string) => void;
    warn: (data: unknown, msg: string) => void;
    error: (data: unknown, msg: string) => void;
  };
}

export interface PreTurnHookResult {
  /** Markdown block appended to the system prompt for this turn. */
  promptAddition?: string;
  /** Extra tools registered for the duration of this turn only. */
  turnTools?: ToolDef[];
}

export interface TurnSummary {
  userMessage: string;
  assistantMessage: string;
  toolCalls: Array<{ name: string; ok: boolean; result?: unknown; error?: string }>;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface Skill {
  manifest: SkillManifest;
  /**
   * Tools this skill permanently registers with the ToolRegistry.
   * Invoked once at skill load time. Returned tools appear to the model as
   * regular tools, gated by their own minTier.
   */
  tools?(): ToolDef[];
  /** Runs at the start of every turn. Return null to skip. */
  onTurnStart?(ctx: SkillContext, userMessage: string): Promise<PreTurnHookResult | null>;
  /** Runs at the end of every turn, after the model's final message. */
  onTurnEnd?(ctx: SkillContext, summary: TurnSummary): Promise<void>;
  /**
   * Explicit invocation entrypoint. Used for `manual` triggers that surface as
   * extension commands or a meta-`skill.invoke` tool exposed to the model.
   */
  invoke?(ctx: SkillContext, input: unknown): Promise<unknown>;
}

import { generateText } from 'ai';
import type { RegistryContext } from '@agent/tools';
import type { SkillManifest } from './manifest.js';
import type { Skill, SkillContext } from './types.js';

/**
 * Build a RegistryContext that auto-allows tool calls at the skill's tier.
 * Used by invoke-style skills that need to run tools (git.diff, shell.run, etc.)
 * without a fresh approval prompt. The skill's own minTier gates what it can
 * reach — skills are registered and tier-checked at skill-registration time,
 * so auto-allow inside a skill's own invoke is safe.
 */
export function buildSkillRegistryContext(ctx: SkillContext): RegistryContext {
  return {
    sessionId: ctx.sessionId,
    projectRoots: ctx.projectRoots,
    session: {
      getTier: () => ctx.currentTier,
      setTier: () => {},
      allowToolForSession: () => {},
      isToolAllowedForSession: () => true,
      reset: () => {},
    } as unknown as RegistryContext['session'],
    approver: {
      requestApproval: async () => ({ action: 'allow-once' as const }),
    },
    signal: ctx.toolContext.signal,
  };
}

/**
 * Execute a tool by name from inside a skill. Returns the raw result or throws
 * with the tool's error message. Skills should call this rather than reaching
 * into the registry directly so the skill stays observable (through future
 * event hooks) and the tier-guard semantics stay consistent.
 */
export async function skillRunTool(
  ctx: SkillContext,
  toolName: string,
  args: unknown,
): Promise<unknown> {
  const regCtx = buildSkillRegistryContext(ctx);
  const res = await ctx.registry.execute(toolName, args, regCtx);
  if (!res.ok) throw new Error(`tool ${toolName} failed: ${res.error ?? 'unknown error'}`);
  return res.result;
}

/**
 * Run a single non-tool-using model call scoped to a skill. Uses the skill's
 * declared `taskType` for routing (fast-cheap for summarizers, high-reasoning
 * for architect-style skills, etc.).
 */
export async function skillModelCall(
  ctx: SkillContext,
  manifest: SkillManifest,
  system: string,
  user: string,
  opts: { maxTokens?: number } = {},
): Promise<{ text: string; inputTokens: number; outputTokens: number; model: string }> {
  const selection = ctx.gateway.selectModel(manifest.taskType);
  const res = await generateText({
    model: selection.model,
    system,
    messages: [{ role: 'user', content: user }],
    ...(opts.maxTokens ? { maxTokens: opts.maxTokens } : {}),
    ...(selection.limits.temperature !== undefined ? { temperature: selection.limits.temperature } : {}),
  });
  return {
    text: res.text,
    inputTokens: res.usage?.promptTokens ?? 0,
    outputTokens: res.usage?.completionTokens ?? 0,
    model: selection.resolvedModel,
  };
}

/**
 * Convenience factory for invoke-only skills: a skill whose only job is to run
 * a model call with a specific system prompt and return the text.
 *
 * Input to invoke() should be a string (the user's natural request) or an
 * object with a `message` field.
 */
export function makePromptSkill(
  manifest: SkillManifest,
  buildSystemPrompt: () => string,
): Skill {
  return {
    manifest,
    async invoke(ctx, input) {
      const userText =
        typeof input === 'string'
          ? input
          : typeof (input as { message?: unknown })?.message === 'string'
            ? ((input as { message: string }).message)
            : JSON.stringify(input ?? {});
      const result = await skillModelCall(ctx, manifest, buildSystemPrompt(), userText, {
        maxTokens: 4096,
      });
      return { text: result.text, model: result.model, tokens: { input: result.inputTokens, output: result.outputTokens } };
    },
  };
}

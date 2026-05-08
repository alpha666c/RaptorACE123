import { generateText } from 'ai';
import type { SkillManifest } from './manifest.js';
import type { Skill, SkillContext } from './types.js';

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

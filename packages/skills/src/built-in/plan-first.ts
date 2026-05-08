import { SkillManifestSchema } from '../manifest.js';
import type { Skill } from '../types.js';

/**
 * Pre-turn skill that nudges the model to plan before implementing on complex
 * asks. Zero additional model cost — it's a prompt addition, not a separate
 * model call. Complements council mode: plan-first is for every complex turn,
 * council is a heavier structured-roles pass.
 */
export const planFirstSkill: Skill = {
  manifest: SkillManifestSchema.parse({
    name: 'plan-first',
    version: '0.1.0',
    description: 'On complex asks, forces a short written plan before the model starts editing.',
    responsibility: 'Reduce wasted tool-calls and wrong-direction edits on multi-step tasks.',
    triggers: [{ type: 'pre-turn' }],
    minTier: 0,
  }),

  async onTurnStart(_ctx, userMessage) {
    const complexity =
      /(refactor|migrate|add (?:feature|a new|support for)|implement|introduce|build|rewrite|redesign|bump|upgrade|create a new)/i.test(
        userMessage,
      ) || userMessage.length > 400;

    if (!complexity) return null;

    return {
      promptAddition: `## Skill: plan-first

This looks like a multi-step change. Before writing any code or calling an edit tool:

1. Output a 3-6 line plan: what you'll change, in what order, and the one invariant you must preserve.
2. THEN start executing.

If the plan would span more than ~6 steps, stop after outputting the plan and ask the user which chunk to start with.

Skip this if the user's ask is a trivial single-file change or a question.`,
    };
  },
};

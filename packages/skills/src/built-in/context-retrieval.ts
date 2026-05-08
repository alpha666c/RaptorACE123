import { SkillManifestSchema } from '../manifest.js';
import type { Skill } from '../types.js';

/**
 * Pre-turn skill: hints the model to proactively retrieve context instead of
 * answering from training. Memory retrieval itself already happens in the
 * agent's core loop; this skill amplifies the behaviour with a prompt nudge
 * that tells the model to search the workspace before answering open questions.
 */
export const contextRetrievalSkill: Skill = {
  manifest: SkillManifestSchema.parse({
    name: 'context-retrieval',
    version: '0.1.0',
    description: 'Nudges the model to read/grep/glob the workspace before answering open questions.',
    responsibility: 'Reduce hallucination by pulling concrete code context into each turn.',
    triggers: [{ type: 'pre-turn' }],
    minTier: 0,
  }),

  async onTurnStart(_ctx, userMessage) {
    const looksOpenEnded =
      /(how does|how do|why does|why do|what(?:'s| is)|explain|show me|walk me through|find|where|which file|list)/i.test(
        userMessage,
      );
    if (!looksOpenEnded) return null;
    return {
      promptAddition: `## Skill: context-retrieval
This question looks like it requires understanding specific code in this workspace.
Before answering from memory or training: use fs.glob to find candidate files,
fs.grep to locate relevant symbols, and fs.read the small files that matter.
Prefer concrete quotes from the code over abstract descriptions.`,
    };
  },
};

import { SkillManifestSchema } from '../manifest.js';
import type { Skill } from '../types.js';

/**
 * Pre-turn skill: when the user wants failing tests fixed, steer the model
 * into a run → parse → fix → re-run loop.
 */
export const testRunnerLoopSkill: Skill = {
  manifest: SkillManifestSchema.parse({
    name: 'test-runner-loop',
    version: '0.1.0',
    description: 'Nudges the model into a test → parse failure → patch → re-test loop when the user wants tests fixed.',
    responsibility: 'Get from red to green without hand-holding, with a hard iteration cap.',
    triggers: [{ type: 'pre-turn' }],
    minTier: 0,
  }),

  async onTurnStart(_ctx, userMessage) {
    if (
      !/(fix (?:the )?tests?|tests? (?:fail|are failing|broken|red)|vitest|pnpm test)/i.test(
        userMessage,
      )
    ) {
      return null;
    }
    return {
      promptAddition: `## Skill: test-runner-loop

The user wants failing tests resolved. Use this iteration loop, max 3 rounds:

1. Run \`pnpm test\` (or \`pnpm -C <package> test\` if the failure is scoped) via shell.run.
2. From the output, identify the failures: which test file, which assertion, what got vs. expected.
3. Read the test file and the production code it exercises.
4. Decide: is the test wrong, or is the code wrong? If unclear, surface the ambiguity to the user and stop.
5. Apply a minimal fs.edit. Do NOT "fix" tests by removing assertions or relaxing expectations unless the user explicitly asks.
6. Re-run \`pnpm test\`. If all green, stop.
7. If still red after 3 iterations, stop and report: which failures remain, what you tried, why it didn't stick.

NEVER alter unrelated tests, add skips, or disable coverage to turn things green.`,
    };
  },
};

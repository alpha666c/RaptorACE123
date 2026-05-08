import { SkillManifestSchema } from '../manifest.js';
import type { Skill } from '../types.js';

/**
 * Pre-turn skill that activates when the user's message looks like they want
 * typecheck errors fixed. Injects a focused prompt block that tells the model
 * to run tsc, parse the errors, edit files, and re-run — instead of guessing.
 */
export const typecheckFixSkill: Skill = {
  manifest: SkillManifestSchema.parse({
    name: 'typecheck-fix',
    version: '0.1.0',
    description: 'When the user asks to fix typecheck errors, nudges the model into a tsc → edit → re-tsc loop.',
    responsibility: 'Turn vague "fix the types" requests into deterministic iterations against tsc output.',
    triggers: [{ type: 'pre-turn' }],
    minTier: 0,
  }),

  async onTurnStart(_ctx, userMessage) {
    if (
      !/(typecheck|type[- ]?error|tsc|type\s+fails?|type\s+errors?|ts\d{4})/i.test(userMessage)
    ) {
      return null;
    }
    return {
      promptAddition: `## Skill: typecheck-fix

The user wants typecheck errors resolved. Follow this pattern strictly:

1. Run \`pnpm typecheck\` (or \`pnpm -C <package> exec tsc --noEmit\` for a single package) via shell.run.
2. Read the FULL tsc output. Each error has a file, line:col, code (TS####), and a message.
3. Group errors by file. Address one file at a time.
4. For each file: fs.read it, then fs.edit with a minimal targeted change.
5. After all edits, re-run tsc. Report the delta: how many errors remain, which files still have issues.
6. Stop if errors persist after 3 iterations — surface them to the user with your best explanation.

DO NOT guess types based on the error text alone without reading the file first. The compiler knows more than the error message says.`,
    };
  },
};

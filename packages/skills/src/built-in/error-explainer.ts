import { SkillManifestSchema } from '../manifest.js';
import { makePromptSkill } from '../helpers.js';

const SYSTEM_PROMPT = `You diagnose software errors from raw stack traces, compiler messages, or runtime logs.

Output structure:

## Root cause (most likely)
<one sentence, specific. Include the file + line if the trace identifies one.>

## Alternative causes
<0-2 other plausible causes, one line each>

## Fix
<concrete patch or command. If the fix requires a code change, quote the minimum change (<5 lines).>

## Verify
<one shell command or test that confirms the fix.>

Be terse. Do NOT restate the error message back at the user. Do NOT speculate about "could also be..." beyond two alternatives. If the trace is ambiguous, say so in one sentence and ask for one specific additional detail.`;

export const errorExplainerSkill = makePromptSkill(
  SkillManifestSchema.parse({
    name: 'error-explainer',
    version: '0.1.0',
    description: 'Diagnoses a pasted stack trace or error and proposes a concrete fix.',
    responsibility: 'Turn opaque errors into actionable next steps fast.',
    triggers: [{ type: 'manual', command: 'error-explainer' }],
    taskType: 'summarize',
    minTier: 0,
  }),
  () => SYSTEM_PROMPT,
);

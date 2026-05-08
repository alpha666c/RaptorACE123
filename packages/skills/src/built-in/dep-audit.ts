import { SkillManifestSchema } from '../manifest.js';
import { skillModelCall, skillRunTool } from '../helpers.js';
import type { Skill } from '../types.js';

const SYSTEM_PROMPT = `You summarize dependency health reports for a developer.

Input: raw output from \`pnpm outdated\` and \`npm audit\` (or similar). Some sections may be empty.

Output structure:

## Security
<list CRITICAL/HIGH findings with package name + CVE/advisory + one-line impact. Max 5. If none, say "No critical or high vulnerabilities.">

## Outdated (worth updating)
<list major & frequently-used deps that are behind by 2+ minors or any major. Max 8. Include current → latest versions.>

## Safe to defer
<single line summary of the rest (e.g. "12 minor/patch updates, low risk").>

## Suggested next actions
<1-3 concrete commands the user can run, e.g. "pnpm up zod@latest">

Be terse. Prefer specifics over general advice. No preamble.`;

export const depAuditSkill: Skill = {
  manifest: SkillManifestSchema.parse({
    name: 'dep-audit',
    version: '0.1.0',
    description: 'Runs pnpm outdated + npm audit and summarises what needs attention.',
    responsibility: 'Surface security + outdated-dep risk without reading raw tool output.',
    triggers: [{ type: 'manual', command: 'dep-audit' }],
    taskType: 'summarize',
    minTier: 3,
  }),

  async invoke(ctx) {
    const outdated = (await skillRunTool(ctx, 'shell.run', {
      command: 'pnpm',
      args: ['outdated', '-r', '--format', 'list'],
      timeoutMs: 60_000,
    }).catch(() => null)) as { stdout?: string; stderr?: string } | null;

    const audit = (await skillRunTool(ctx, 'shell.run', {
      command: 'npm',
      args: ['audit', '--json'],
      timeoutMs: 60_000,
    }).catch(() => null)) as { stdout?: string; stderr?: string } | null;

    const payload = [
      `## pnpm outdated\n\`\`\`\n${outdated?.stdout?.slice(0, 8000) ?? '(no output)'}\n\`\`\``,
      `## npm audit (JSON)\n\`\`\`\n${audit?.stdout?.slice(0, 8000) ?? '(no output)'}\n\`\`\``,
    ].join('\n\n');

    const result = await skillModelCall(ctx, this.manifest, SYSTEM_PROMPT, payload, {
      maxTokens: 1200,
    });
    return {
      text: result.text.trim(),
      tokens: { input: result.inputTokens, output: result.outputTokens },
      model: result.model,
    };
  },
};

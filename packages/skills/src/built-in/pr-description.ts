import { SkillManifestSchema } from '../manifest.js';
import { skillModelCall, skillRunTool } from '../helpers.js';
import type { Skill } from '../types.js';

const SYSTEM_PROMPT = `You write pull-request descriptions from branch diffs.

Output exactly this markdown structure, nothing else:

## Summary
<2-4 bullets on WHAT changed and WHY. Concrete. Reference files/modules by name.>

## Test plan
<checklist, one [ ] per item. Commands the reviewer runs to verify.>

Rules:
- No preamble. No "This PR...". No code fences around the output.
- Test plan items MUST be actionable (e.g. "[ ] run \`pnpm -C packages/tools test\`"), not vague ("[ ] make sure it works").
- If the diff adds new user-facing behaviour, include an "ops impact" line in the Summary.`;

export const prDescriptionSkill: Skill = {
  manifest: SkillManifestSchema.parse({
    name: 'pr-description',
    version: '0.1.0',
    description: 'Writes a PR description (Summary + Test plan) from the branch diff vs. the base branch.',
    responsibility: 'Save you from writing PR bodies manually.',
    triggers: [{ type: 'manual', command: 'pr-description' }],
    taskType: 'summarize',
    minTier: 0,
  }),

  async invoke(ctx, input) {
    const baseBranch =
      typeof (input as { base?: unknown })?.base === 'string'
        ? ((input as { base: string }).base)
        : 'main';

    // Use shell to produce `git diff <base>...HEAD` via the structured git tools.
    // git.diff accepts a `staged` flag but we want branch-to-branch; so use shell.run.
    const diffRun = (await skillRunTool(ctx, 'shell.run', {
      command: 'git',
      args: ['diff', `${baseBranch}...HEAD`, '--unified=3', '--no-color'],
      timeoutMs: 30_000,
    }).catch(() => null)) as { stdout?: string; exitCode?: number } | null;

    const diff = diffRun?.stdout ?? '';
    if (!diff.trim()) {
      return {
        text: `No diff between HEAD and ${baseBranch}. Did you commit your changes on a feature branch?`,
      };
    }
    const log = (await skillRunTool(ctx, 'shell.run', {
      command: 'git',
      args: ['log', `${baseBranch}..HEAD`, '--oneline'],
      timeoutMs: 15_000,
    }).catch(() => null)) as { stdout?: string } | null;

    const payload = [
      `## Commits (${baseBranch}..HEAD)\n${log?.stdout ?? '(no commit log available)'}`,
      `## Diff (first 12k chars)\n\`\`\`diff\n${diff.slice(0, 12_000)}\n\`\`\``,
    ].join('\n\n');
    const result = await skillModelCall(ctx, this.manifest, SYSTEM_PROMPT, payload, {
      maxTokens: 900,
    });
    return {
      text: result.text.trim(),
      tokens: { input: result.inputTokens, output: result.outputTokens },
      model: result.model,
    };
  },
};

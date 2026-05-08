import { SkillManifestSchema } from '../manifest.js';
import { skillModelCall, skillRunTool } from '../helpers.js';
import type { Skill } from '../types.js';

const SYSTEM_PROMPT = `You write conventional commit messages from staged git diffs.

Output format (EXACTLY one commit message, nothing else):

<type>(<scope>): <subject>

<body — 1-3 short paragraphs describing WHY, not what. Skip if the subject is enough.>

Rules:
- type: feat, fix, refactor, docs, test, chore, perf, build, ci.
- scope: the package/module most affected, lowercase kebab. Omit if cross-cutting.
- subject: imperative mood, under 70 chars, no trailing period.
- body: explain motivation and side-effects when non-obvious. Never restate the diff line-by-line.
- No code fences. No preamble. No "This commit...".`;

export const commitMessageSkill: Skill = {
  manifest: SkillManifestSchema.parse({
    name: 'commit-message',
    version: '0.1.0',
    description: 'Writes a conventional commit message from the currently staged diff.',
    responsibility: 'Save you from writing commit messages manually.',
    triggers: [{ type: 'manual', command: 'commit-message' }],
    taskType: 'summarize',
    minTier: 0,
  }),

  async invoke(ctx) {
    const diffResult = (await skillRunTool(ctx, 'git.diff', {
      staged: true,
      contextLines: 3,
    })) as { diff: string; truncated: boolean };
    if (!diffResult.diff.trim()) {
      return { text: 'No staged changes. Stage something with `git add` first.' };
    }
    // Cap the diff — commit messages don't benefit from full context beyond ~8k chars.
    const diff = diffResult.diff.slice(0, 8000);
    const result = await skillModelCall(
      ctx,
      this.manifest,
      SYSTEM_PROMPT,
      `## Staged diff\n\`\`\`diff\n${diff}\n\`\`\``,
      { maxTokens: 400 },
    );
    return {
      text: result.text.trim(),
      tokens: { input: result.inputTokens, output: result.outputTokens },
      model: result.model,
    };
  },
};

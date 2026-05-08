import { getLogger } from '@agent/shared';
import { SkillManifestSchema } from '../manifest.js';
import { skillModelCall } from '../helpers.js';
import type { Skill, TurnSummary } from '../types.js';

const log = getLogger('skill.code-review');

const SYSTEM_PROMPT = `You are reviewing code edits the agent just made. Give a terse, honest review.

Output rules:
- If the changes look correct and follow convention: reply with exactly "OK" (no other text).
- Otherwise: return up to 5 concrete findings, each on its own line, in the form:
  "- <severity>: <file_path>: <one-sentence finding>"
  where <severity> is one of: BLOCKER, WARNING, NIT.
- Do NOT summarize what the agent did. Do NOT add headers, conclusions, or fluff.
- No code fences. Plain text only.

Reserve BLOCKER for: correctness bugs, security issues, scope-boundary violations, broken imports, type-errors-likely.
WARNING: code smell, missing tests, unclear naming, probable perf issue, dead code.
NIT: style, typos, minor cleanup.`;

function wasAnEdit(summary: TurnSummary): boolean {
  return summary.toolCalls.some(
    (c) => c.ok && (c.name === 'fs.write' || c.name === 'fs.edit' || c.name === 'git.commit'),
  );
}

export const codeReviewSkill: Skill = {
  manifest: SkillManifestSchema.parse({
    name: 'code-review',
    version: '0.1.0',
    description: 'Runs a read-only model pass over edits made during the turn; surfaces blockers/warnings/nits.',
    responsibility: 'Catch obvious regressions in agent-made edits before the user merges them.',
    triggers: [{ type: 'post-turn' }],
    taskType: 'review',
    minTier: 0,
  }),

  async onTurnEnd(ctx, summary) {
    if (!wasAnEdit(summary)) return;

    const editedPaths: string[] = [];
    for (const call of summary.toolCalls) {
      if (!call.ok) continue;
      if (call.name === 'fs.write' || call.name === 'fs.edit') {
        const p = (call.result as { path?: string } | undefined)?.path;
        if (typeof p === 'string') editedPaths.push(p);
      }
    }
    if (editedPaths.length === 0) return;

    // Read each edited file once, cap total payload to keep the review bounded.
    const MAX_TOTAL = 12_000;
    const snippets: string[] = [];
    let consumed = 0;
    for (const p of editedPaths.slice(0, 8)) {
      if (consumed >= MAX_TOTAL) break;
      const readRes = await ctx.registry.execute('fs.read', { path: p }, {
        sessionId: ctx.sessionId,
        projectRoots: ctx.projectRoots,
        session: { getTier: () => ctx.currentTier } as never,
        approver: { requestApproval: async () => ({ action: 'allow-once' as const }) },
      }).catch(() => null);
      if (!readRes?.ok) continue;
      const content = (readRes.result as { content?: string } | undefined)?.content ?? '';
      const slice = content.slice(0, MAX_TOTAL - consumed);
      consumed += slice.length;
      snippets.push(`--- ${p} ---\n${slice}`);
    }
    if (snippets.length === 0) return;

    const userPayload = [
      `## User asked:\n${summary.userMessage}`,
      `## Agent's response:\n${summary.assistantMessage.slice(0, 2000)}`,
      `## Files touched:\n${snippets.join('\n\n')}`,
    ].join('\n\n');

    try {
      const result = await skillModelCall(ctx, this.manifest, SYSTEM_PROMPT, userPayload, {
        maxTokens: 800,
      });
      const text = result.text.trim();
      if (text && text !== 'OK') {
        log.info({ findings: text.slice(0, 600) }, 'code-review.findings');
      }
    } catch (e) {
      log.warn({ err: (e as Error).message }, 'code-review.failed');
    }
  },
};

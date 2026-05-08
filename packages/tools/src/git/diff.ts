import { TIER } from '@agent/shared';
import { z } from 'zod';
import { assertInsideRoots } from '../scoping.js';
import { buildScrubbedEnv, runCommand } from '../proc.js';
import type { ToolDef } from '../types.js';

const params = z.object({
  cwd: z.string().optional().describe('Repo root, defaults to first project root.'),
  staged: z.boolean().optional().default(false).describe('If true, diff the index vs HEAD (--cached); else working tree vs index.'),
  paths: z.array(z.string()).optional().describe('Optional path filters (relative to repo root).'),
  contextLines: z.number().int().min(0).max(10).optional().default(3),
});

export const gitDiffTool: ToolDef<typeof params, { diff: string; truncated: boolean }> = {
  name: 'git.diff',
  description: 'Show git diff. By default: working tree vs index. Set staged=true for index vs HEAD.',
  minTier: TIER.READ_ONLY,
  parameters: params,
  async execute(args, ctx) {
    const cwdRaw = args.cwd ?? ctx.projectRoots[0];
    if (!cwdRaw) throw new Error('No project root configured.');
    const cwd = assertInsideRoots(cwdRaw, ctx.projectRoots);

    const gitArgs: string[] = ['diff', `--unified=${args.contextLines}`, '--no-color'];
    if (args.staged) gitArgs.push('--cached');
    if (args.paths && args.paths.length > 0) {
      gitArgs.push('--');
      for (const p of args.paths) {
        // Validate that each path is inside the repo scope before passing it to git.
        assertInsideRoots(p, ctx.projectRoots);
        gitArgs.push(p);
      }
    }

    const res = await runCommand('git', gitArgs, {
      cwd,
      timeoutMs: 30_000,
      maxOutputBytes: 2_000_000,
      env: buildScrubbedEnv(),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });
    if (res.exitCode !== 0 && res.exitCode !== 1) {
      // git diff returns 1 when there are differences — that's not an error.
      throw new Error(`git diff failed (exit ${res.exitCode}): ${res.stderr.slice(0, 500)}`);
    }
    return { diff: res.stdout, truncated: res.truncated };
  },
};

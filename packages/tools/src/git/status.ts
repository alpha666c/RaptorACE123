import { TIER } from '@agent/shared';
import { z } from 'zod';
import { assertInsideRoots } from '../scoping.js';
import { buildScrubbedEnv, runCommand } from '../proc.js';
import type { ToolDef } from '../types.js';

const params = z.object({
  cwd: z.string().optional().describe('Repo root, defaults to first project root.'),
});

interface StatusEntry {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  renamedFrom?: string;
}

export const gitStatusTool: ToolDef<
  typeof params,
  { clean: boolean; branch: string | null; entries: StatusEntry[] }
> = {
  name: 'git.status',
  description: 'Show git working-tree status (porcelain v1). Reports staged/unstaged changes and current branch.',
  minTier: TIER.READ_ONLY,
  parameters: params,
  async execute(args, ctx) {
    const cwdRaw = args.cwd ?? ctx.projectRoots[0];
    if (!cwdRaw) throw new Error('No project root configured.');
    const cwd = assertInsideRoots(cwdRaw, ctx.projectRoots);
    const res = await runCommand('git', ['status', '--porcelain=v1', '--branch'], {
      cwd,
      timeoutMs: 15_000,
      maxOutputBytes: 1_000_000,
      env: buildScrubbedEnv(),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });
    if (res.exitCode !== 0) {
      throw new Error(`git status failed (exit ${res.exitCode}): ${res.stderr.slice(0, 500)}`);
    }
    const lines = res.stdout.split('\n');
    let branch: string | null = null;
    const entries: StatusEntry[] = [];
    for (const ln of lines) {
      if (!ln) continue;
      if (ln.startsWith('## ')) {
        const branchLine = ln.slice(3);
        branch = branchLine.split('...')[0]?.trim() ?? branchLine;
        continue;
      }
      // porcelain v1: "XY path" or "R  old -> new"
      const X = ln[0] ?? ' ';
      const Y = ln[1] ?? ' ';
      const rest = ln.slice(3);
      const arrow = rest.indexOf(' -> ');
      if (arrow >= 0) {
        entries.push({
          indexStatus: X,
          worktreeStatus: Y,
          renamedFrom: rest.slice(0, arrow),
          path: rest.slice(arrow + 4),
        });
      } else {
        entries.push({ indexStatus: X, worktreeStatus: Y, path: rest });
      }
    }
    return { clean: entries.length === 0, branch, entries };
  },
};

import { TIER } from '@agent/shared';
import { z } from 'zod';
import { assertInsideRoots } from '../scoping.js';
import { buildScrubbedEnv, runCommand } from '../proc.js';
import type { ToolDef } from '../types.js';

const params = z.object({
  cwd: z.string().optional().describe('Repo root, defaults to first project root.'),
  includeRemote: z.boolean().optional().default(false).describe('Include remote-tracking branches.'),
});

export const gitBranchTool: ToolDef<
  typeof params,
  { current: string | null; local: string[]; remote: string[] }
> = {
  name: 'git.branch',
  description: 'List git branches (local + optionally remote-tracking). Tier 0 — read-only.',
  minTier: TIER.READ_ONLY,
  parameters: params,
  async execute(args, ctx) {
    const cwdRaw = args.cwd ?? ctx.projectRoots[0];
    if (!cwdRaw) throw new Error('No project root configured.');
    const cwd = assertInsideRoots(cwdRaw, ctx.projectRoots);
    const env = buildScrubbedEnv();

    const currentRes = await runCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      timeoutMs: 10_000,
      maxOutputBytes: 1024,
      env,
    });
    const current = currentRes.exitCode === 0 ? currentRes.stdout.trim() || null : null;

    const localRes = await runCommand(
      'git',
      ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'],
      { cwd, timeoutMs: 15_000, maxOutputBytes: 500_000, env },
    );
    if (localRes.exitCode !== 0) {
      throw new Error(`git branch failed (exit ${localRes.exitCode}): ${localRes.stderr.slice(0, 500)}`);
    }
    const local = localRes.stdout.split('\n').filter(Boolean);

    let remote: string[] = [];
    if (args.includeRemote) {
      const remoteRes = await runCommand(
        'git',
        ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/'],
        { cwd, timeoutMs: 15_000, maxOutputBytes: 500_000, env },
      );
      if (remoteRes.exitCode === 0) {
        remote = remoteRes.stdout.split('\n').filter(Boolean);
      }
    }

    return { current, local, remote };
  },
};

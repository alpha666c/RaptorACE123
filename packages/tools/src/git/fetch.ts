import { TIER } from '@agent/shared';
import { z } from 'zod';
import { assertInsideRoots } from '../scoping.js';
import { buildScrubbedEnv, runCommand } from '../proc.js';
import type { ToolDef } from '../types.js';

const params = z.object({
  cwd: z.string().optional().describe('Repo root, defaults to first project root.'),
  remote: z.string().optional().default('origin').describe('Remote to fetch from.'),
  prune: z.boolean().optional().default(false).describe('Pass --prune.'),
  all: z.boolean().optional().default(false).describe('If true, fetch from all remotes (--all).'),
});

export const gitFetchTool: ToolDef<
  typeof params,
  { fetched: boolean; stdout: string; stderr: string; exitCode: number }
> = {
  name: 'git.fetch',
  description:
    'Fetch refs from a remote. Does not modify the working tree. Tier 4 — touches the network.',
  minTier: TIER.BROADER_COMMANDS,
  parameters: params,
  async buildPreview(args) {
    return {
      kind: 'text',
      content: args.all
        ? `$ git fetch --all${args.prune ? ' --prune' : ''}`
        : `$ git fetch${args.prune ? ' --prune' : ''} ${args.remote}`,
    };
  },
  async execute(args, ctx) {
    const cwdRaw = args.cwd ?? ctx.projectRoots[0];
    if (!cwdRaw) throw new Error('No project root configured.');
    const cwd = assertInsideRoots(cwdRaw, ctx.projectRoots);

    const argv = ['fetch'];
    if (args.prune) argv.push('--prune');
    if (args.all) argv.push('--all');
    else argv.push(args.remote);

    const res = await runCommand('git', argv, {
      cwd,
      timeoutMs: 120_000,
      maxOutputBytes: 1_000_000,
      env: buildScrubbedEnv(),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });
    return {
      fetched: res.exitCode === 0,
      stdout: res.stdout,
      stderr: res.stderr,
      exitCode: res.exitCode,
    };
  },
};

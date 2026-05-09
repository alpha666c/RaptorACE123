import { TIER } from '@agent/shared';
import { z } from 'zod';
import { assertInsideRoots } from '../scoping.js';
import { buildScrubbedEnv, runCommand } from '../proc.js';
import type { ToolDef } from '../types.js';

const params = z.object({
  cwd: z.string().optional().describe('Repo root, defaults to first project root.'),
  remote: z.string().optional().default('origin').describe('Remote to pull from.'),
  branch: z.string().optional().describe('Branch to pull; defaults to the current branch.'),
  rebase: z.boolean().optional().default(false).describe('Pass --rebase instead of merging.'),
  ffOnly: z.boolean().optional().default(false).describe('Pass --ff-only (refuse to create a merge commit).'),
});

export const gitPullTool: ToolDef<
  typeof params,
  {
    pulled: boolean;
    remote: string;
    branch: string | null;
    stdout: string;
    stderr: string;
    exitCode: number;
  }
> = {
  name: 'git.pull',
  description:
    'Pull from a remote (fetch + merge/rebase). Tier 4 — touches the network and can change the working tree.',
  minTier: TIER.BROADER_COMMANDS,
  parameters: params,
  async buildPreview(args) {
    const strategy = args.rebase ? '--rebase' : args.ffOnly ? '--ff-only' : '(merge)';
    return {
      kind: 'text',
      content: `$ git pull ${strategy} ${args.remote}${args.branch ? ` ${args.branch}` : ''}`.trim(),
    };
  },
  async execute(args, ctx) {
    const cwdRaw = args.cwd ?? ctx.projectRoots[0];
    if (!cwdRaw) throw new Error('No project root configured.');
    const cwd = assertInsideRoots(cwdRaw, ctx.projectRoots);

    if (args.branch && args.branch.startsWith('-')) {
      throw new Error(`Refusing suspicious branch name: ${args.branch}`);
    }

    const argv = ['pull'];
    if (args.rebase) argv.push('--rebase');
    if (args.ffOnly) argv.push('--ff-only');
    argv.push(args.remote);
    if (args.branch) argv.push(args.branch);

    const res = await runCommand('git', argv, {
      cwd,
      timeoutMs: 180_000,
      maxOutputBytes: 1_000_000,
      env: buildScrubbedEnv(),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });
    return {
      pulled: res.exitCode === 0,
      remote: args.remote,
      branch: args.branch ?? null,
      stdout: res.stdout,
      stderr: res.stderr,
      exitCode: res.exitCode,
    };
  },
};

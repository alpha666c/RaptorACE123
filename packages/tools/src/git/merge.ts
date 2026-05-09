import { TIER } from '@agent/shared';
import { z } from 'zod';
import { assertInsideRoots } from '../scoping.js';
import { buildScrubbedEnv, runCommand } from '../proc.js';
import type { ToolDef } from '../types.js';

const params = z.object({
  cwd: z.string().optional().describe('Repo root, defaults to first project root.'),
  branch: z.string().optional().describe('Branch or ref to merge into the current branch. Required unless abort=true.'),
  noFastForward: z.boolean().optional().default(false).describe('Pass --no-ff (always create a merge commit).'),
  abort: z.boolean().optional().default(false).describe('If true, aborts an in-progress merge instead of starting one.'),
});

export const gitMergeTool: ToolDef<
  typeof params,
  { merged: boolean; branch: string | null; stdout: string; stderr: string; exitCode: number }
> = {
  name: 'git.merge',
  description:
    'Merge a branch into the current branch, or abort an in-progress merge (abort=true). Tier 3.',
  minTier: TIER.SAFE_COMMANDS,
  parameters: params,
  async buildPreview(args) {
    if (args.abort) return { kind: 'text', content: '$ git merge --abort' };
    return {
      kind: 'text',
      content: `$ git merge${args.noFastForward ? ' --no-ff' : ''} ${args.branch ?? '(no branch specified)'}`,
    };
  },
  async execute(args, ctx) {
    const cwdRaw = args.cwd ?? ctx.projectRoots[0];
    if (!cwdRaw) throw new Error('No project root configured.');
    const cwd = assertInsideRoots(cwdRaw, ctx.projectRoots);

    let argv: string[];
    if (args.abort) {
      argv = ['merge', '--abort'];
    } else {
      if (!args.branch) throw new Error('`branch` is required when abort=false.');
      if (args.branch.startsWith('-')) {
        throw new Error(`Refusing suspicious ref: ${args.branch}`);
      }
      argv = ['merge'];
      if (args.noFastForward) argv.push('--no-ff');
      argv.push(args.branch);
    }

    const res = await runCommand('git', argv, {
      cwd,
      timeoutMs: 60_000,
      maxOutputBytes: 1_000_000,
      env: buildScrubbedEnv(),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });
    return {
      merged: res.exitCode === 0 && !args.abort,
      branch: args.abort ? null : (args.branch ?? null),
      stdout: res.stdout,
      stderr: res.stderr,
      exitCode: res.exitCode,
    };
  },
};

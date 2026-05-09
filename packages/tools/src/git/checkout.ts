import { TIER } from '@agent/shared';
import { z } from 'zod';
import { assertInsideRoots } from '../scoping.js';
import { buildScrubbedEnv, runCommand } from '../proc.js';
import type { ToolDef } from '../types.js';

const params = z.object({
  cwd: z.string().optional().describe('Repo root, defaults to first project root.'),
  branch: z.string().min(1).describe('Branch to switch to (or create with createNew=true).'),
  createNew: z
    .boolean()
    .optional()
    .default(false)
    .describe('If true, create the branch before switching (-b).'),
  startPoint: z
    .string()
    .optional()
    .describe('When createNew=true, create from this ref instead of HEAD.'),
});

/**
 * Switch to an existing branch, or create a new one and switch. Deliberately
 * does NOT accept pathspecs — use `git.restore` to unstage, `shell.run` for
 * destructive pathspec checkout.
 */
export const gitCheckoutTool: ToolDef<
  typeof params,
  { switched: boolean; branch: string; stdout: string; stderr: string; exitCode: number }
> = {
  name: 'git.checkout',
  description:
    'Switch to a git branch (optionally creating it with createNew=true). Refuses pathspec-style discards. Tier 3.',
  minTier: TIER.SAFE_COMMANDS,
  parameters: params,
  async buildPreview(args) {
    return {
      kind: 'text',
      content: args.createNew
        ? `$ git checkout -b ${args.branch}${args.startPoint ? ` ${args.startPoint}` : ''}`
        : `$ git checkout ${args.branch}`,
    };
  },
  async execute(args, ctx) {
    const cwdRaw = args.cwd ?? ctx.projectRoots[0];
    if (!cwdRaw) throw new Error('No project root configured.');
    const cwd = assertInsideRoots(cwdRaw, ctx.projectRoots);

    if (args.branch === '.' || args.branch.startsWith('-')) {
      throw new Error(`Refusing suspicious branch name: ${args.branch}`);
    }
    if (args.startPoint && args.startPoint.startsWith('-')) {
      throw new Error(`Refusing suspicious start point: ${args.startPoint}`);
    }

    const argv = ['checkout'];
    if (args.createNew) argv.push('-b');
    argv.push(args.branch);
    if (args.createNew && args.startPoint) argv.push(args.startPoint);

    const res = await runCommand('git', argv, {
      cwd,
      timeoutMs: 30_000,
      maxOutputBytes: 500_000,
      env: buildScrubbedEnv(),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });
    return {
      switched: res.exitCode === 0,
      branch: args.branch,
      stdout: res.stdout,
      stderr: res.stderr,
      exitCode: res.exitCode,
    };
  },
};

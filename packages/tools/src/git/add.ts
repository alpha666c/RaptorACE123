import { TIER } from '@agent/shared';
import { z } from 'zod';
import { assertInsideRoots } from '../scoping.js';
import { buildScrubbedEnv, runCommand } from '../proc.js';
import type { ToolDef } from '../types.js';

const params = z.object({
  cwd: z.string().optional().describe('Repo root, defaults to first project root.'),
  paths: z
    .array(z.string())
    .min(1)
    .describe('Paths to stage. Each must resolve inside a project root.'),
});

export const gitAddTool: ToolDef<
  typeof params,
  { staged: string[]; stdout: string; stderr: string }
> = {
  name: 'git.add',
  description: 'Stage paths for commit. Tier 3 — safe command.',
  minTier: TIER.SAFE_COMMANDS,
  parameters: params,
  async buildPreview(args) {
    return {
      kind: 'text',
      content: `$ git add -- ${args.paths.join(' ')}`,
    };
  },
  async execute(args, ctx) {
    const cwdRaw = args.cwd ?? ctx.projectRoots[0];
    if (!cwdRaw) throw new Error('No project root configured.');
    const cwd = assertInsideRoots(cwdRaw, ctx.projectRoots);
    for (const p of args.paths) assertInsideRoots(p, ctx.projectRoots);

    const res = await runCommand('git', ['add', '--', ...args.paths], {
      cwd,
      timeoutMs: 30_000,
      maxOutputBytes: 500_000,
      env: buildScrubbedEnv(),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });
    if (res.exitCode !== 0) {
      throw new Error(`git add failed (exit ${res.exitCode}): ${res.stderr.slice(0, 500)}`);
    }
    return { staged: args.paths, stdout: res.stdout, stderr: res.stderr };
  },
};

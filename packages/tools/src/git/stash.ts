import { TIER } from '@agent/shared';
import { z } from 'zod';
import { assertInsideRoots } from '../scoping.js';
import { buildScrubbedEnv, runCommand } from '../proc.js';
import type { ToolDef } from '../types.js';

const params = z.object({
  cwd: z.string().optional().describe('Repo root, defaults to first project root.'),
  action: z.enum(['push', 'pop', 'apply', 'drop', 'list']).describe('Stash action to perform.'),
  message: z.string().optional().describe('Message for `push`.'),
  index: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Stash index for pop/apply/drop (e.g. 0 → stash@{0}). Pop/apply default to newest.'),
  includeUntracked: z.boolean().optional().default(false).describe('For `push` — include untracked files.'),
});

export const gitStashTool: ToolDef<
  typeof params,
  { action: string; stdout: string; stderr: string; exitCode: number }
> = {
  name: 'git.stash',
  description:
    'Manage the git stash: push (save), pop, apply, drop, or list. Tier 3 — safe command.',
  minTier: TIER.SAFE_COMMANDS,
  parameters: params,
  async buildPreview(args) {
    switch (args.action) {
      case 'push':
        return {
          kind: 'text',
          content: `$ git stash push${args.includeUntracked ? ' --include-untracked' : ''}${args.message ? ` -m "${args.message}"` : ''}`,
        };
      case 'pop':
        return {
          kind: 'text',
          content: `$ git stash pop${args.index !== undefined ? ` stash@{${args.index}}` : ''}`,
        };
      case 'apply':
        return {
          kind: 'text',
          content: `$ git stash apply${args.index !== undefined ? ` stash@{${args.index}}` : ''}`,
        };
      case 'drop':
        return { kind: 'text', content: `$ git stash drop stash@{${args.index ?? 0}}` };
      case 'list':
        return { kind: 'text', content: '$ git stash list' };
    }
  },
  async execute(args, ctx) {
    const cwdRaw = args.cwd ?? ctx.projectRoots[0];
    if (!cwdRaw) throw new Error('No project root configured.');
    const cwd = assertInsideRoots(cwdRaw, ctx.projectRoots);

    const argv: string[] = ['stash'];
    switch (args.action) {
      case 'push':
        argv.push('push');
        if (args.includeUntracked) argv.push('--include-untracked');
        if (args.message) argv.push('-m', args.message);
        break;
      case 'pop':
        argv.push('pop');
        if (args.index !== undefined) argv.push(`stash@{${args.index}}`);
        break;
      case 'apply':
        argv.push('apply');
        if (args.index !== undefined) argv.push(`stash@{${args.index}}`);
        break;
      case 'drop':
        argv.push('drop', `stash@{${args.index ?? 0}}`);
        break;
      case 'list':
        argv.push('list');
        break;
    }

    const res = await runCommand('git', argv, {
      cwd,
      timeoutMs: 30_000,
      maxOutputBytes: 1_000_000,
      env: buildScrubbedEnv(),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });
    return {
      action: args.action,
      stdout: res.stdout,
      stderr: res.stderr,
      exitCode: res.exitCode,
    };
  },
};

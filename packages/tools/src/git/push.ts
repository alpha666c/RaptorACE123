import { TIER } from '@agent/shared';
import { z } from 'zod';
import { assertInsideRoots } from '../scoping.js';
import { buildScrubbedEnv, runCommand } from '../proc.js';
import type { ToolDef } from '../types.js';

const params = z.object({
  cwd: z.string().optional().describe('Repo root, defaults to first project root.'),
  remote: z.string().optional().default('origin').describe('Remote to push to.'),
  branch: z
    .string()
    .optional()
    .describe('Branch to push. Defaults to the current branch (HEAD).'),
  setUpstream: z
    .boolean()
    .optional()
    .default(false)
    .describe('If true, runs with -u to set the upstream for the branch.'),
});

/**
 * Push the current branch (or a named branch) to a remote. Tier 4 — "broader
 * commands" — because it affects shared state outside the local workspace.
 *
 * Deliberately does NOT support:
 *   - `--force` / `--force-with-lease` (destructive, easy to regret)
 *   - pushing tags
 *   - pushing refspecs
 * If you need those, run the command via `shell.run` with an appropriate
 * allowlist entry, or use the terminal directly.
 */
export const gitPushTool: ToolDef<
  typeof params,
  {
    pushed: boolean;
    remote: string;
    branch: string;
    stdout: string;
    stderr: string;
    exitCode: number;
  }
> = {
  name: 'git.push',
  description:
    'Push the current (or named) branch to a remote. Tier 4 — affects the remote repository. Never force-pushes.',
  minTier: TIER.BROADER_COMMANDS,
  parameters: params,

  async buildPreview(args, ctx) {
    const cwdRaw = args.cwd ?? ctx.projectRoots[0];
    if (!cwdRaw) return { kind: 'text', content: 'Missing project root.' };
    const cwd = assertInsideRoots(cwdRaw, ctx.projectRoots);
    const env = buildScrubbedEnv();

    const resolvedBranch =
      args.branch ??
      (await runCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd,
        timeoutMs: 10_000,
        maxOutputBytes: 1024,
        env,
      }).then((r) => r.stdout.trim()));
    const branch = resolvedBranch || '(current branch)';

    const unpushed = await runCommand(
      'git',
      ['log', '--oneline', `${args.remote}/${branch}..HEAD`],
      {
        cwd,
        timeoutMs: 10_000,
        maxOutputBytes: 100_000,
        env,
      },
    ).catch(() => ({ stdout: '(no remote-tracking comparison available)' }));

    const setUp = args.setUpstream ? ' -u' : '';
    return {
      kind: 'text',
      content:
        `$ git push${setUp} ${args.remote} ${branch}\n\n` +
        `Commits about to be pushed:\n${unpushed.stdout || '(none or no remote tracking set)'}`,
    };
  },

  async execute(args, ctx) {
    const cwdRaw = args.cwd ?? ctx.projectRoots[0];
    if (!cwdRaw) throw new Error('No project root configured.');
    const cwd = assertInsideRoots(cwdRaw, ctx.projectRoots);
    const env = buildScrubbedEnv();

    const branch =
      args.branch ??
      (
        await runCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd,
          timeoutMs: 10_000,
          maxOutputBytes: 1024,
          env,
        })
      ).stdout.trim();

    if (!branch) {
      throw new Error('Could not resolve current branch and no branch specified.');
    }

    const argv = ['push'];
    if (args.setUpstream) argv.push('-u');
    argv.push(args.remote, branch);

    const res = await runCommand('git', argv, {
      cwd,
      timeoutMs: 120_000,
      maxOutputBytes: 500_000,
      env,
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });

    return {
      pushed: res.exitCode === 0,
      remote: args.remote,
      branch,
      stdout: res.stdout,
      stderr: res.stderr,
      exitCode: res.exitCode,
    };
  },
};

import { TIER } from '@agent/shared';
import { z } from 'zod';
import { assertInsideRoots } from '../scoping.js';
import { buildScrubbedEnv, runCommand } from '../proc.js';
import type { ToolDef } from '../types.js';

const params = z.object({
  cwd: z.string().optional().describe('Repo root, defaults to first project root.'),
  message: z.string().min(1).max(4000).describe('Commit message.'),
  addPaths: z
    .array(z.string())
    .optional()
    .describe('Specific paths to stage before committing. If omitted, only already-staged changes are committed.'),
  allowEmpty: z.boolean().optional().default(false),
});

export const gitCommitTool: ToolDef<
  typeof params,
  { committed: boolean; sha: string | null; message: string; stdout: string; stderr: string }
> = {
  name: 'git.commit',
  description:
    'Commit staged changes (or optionally stage specific paths first, then commit). Tier 3 — requires "Safe commands" permission.',
  minTier: TIER.SAFE_COMMANDS,
  async buildPreview(args, ctx) {
    const cwdRaw = args.cwd ?? ctx.projectRoots[0];
    if (!cwdRaw) return { kind: 'text', content: 'Missing project root.' };
    const cwd = assertInsideRoots(cwdRaw, ctx.projectRoots);
    const diff = await runCommand('git', ['diff', '--cached', '--stat'], {
      cwd,
      timeoutMs: 15_000,
      maxOutputBytes: 500_000,
      env: buildScrubbedEnv(),
    });
    const addLine = args.addPaths?.length ? `Will stage: ${args.addPaths.join(', ')}\n\n` : '';
    return {
      kind: 'text',
      content: `${addLine}Commit message:\n${args.message}\n\nStaged changes:\n${diff.stdout || '(none yet)'}`,
    };
  },
  parameters: params,
  async execute(args, ctx) {
    const cwdRaw = args.cwd ?? ctx.projectRoots[0];
    if (!cwdRaw) throw new Error('No project root configured.');
    const cwd = assertInsideRoots(cwdRaw, ctx.projectRoots);
    const env = buildScrubbedEnv();

    if (args.addPaths && args.addPaths.length > 0) {
      for (const p of args.addPaths) assertInsideRoots(p, ctx.projectRoots);
      const stage = await runCommand('git', ['add', '--', ...args.addPaths], {
        cwd,
        timeoutMs: 30_000,
        maxOutputBytes: 500_000,
        env,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });
      if (stage.exitCode !== 0) {
        throw new Error(`git add failed (exit ${stage.exitCode}): ${stage.stderr.slice(0, 500)}`);
      }
    }

    const commitArgs = ['commit', '-m', args.message];
    if (args.allowEmpty) commitArgs.push('--allow-empty');
    const commit = await runCommand('git', commitArgs, {
      cwd,
      timeoutMs: 30_000,
      maxOutputBytes: 500_000,
      env,
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });

    if (commit.exitCode !== 0) {
      return {
        committed: false,
        sha: null,
        message: args.message,
        stdout: commit.stdout,
        stderr: commit.stderr,
      };
    }
    const shaResult = await runCommand('git', ['rev-parse', 'HEAD'], {
      cwd,
      timeoutMs: 10_000,
      maxOutputBytes: 1024,
      env,
    });
    const sha = shaResult.exitCode === 0 ? shaResult.stdout.trim() : null;
    return { committed: true, sha, message: args.message, stdout: commit.stdout, stderr: commit.stderr };
  },
};

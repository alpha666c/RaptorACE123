import { TIER } from '@agent/shared';
import { z } from 'zod';
import { assertInsideRoots } from '../scoping.js';
import { buildScrubbedEnv, runCommand } from '../proc.js';
import type { ToolDef } from '../types.js';

const params = z.object({
  cwd: z.string().optional().describe('Repo root, defaults to first project root.'),
  limit: z.number().int().min(1).max(500).optional().default(30),
  paths: z.array(z.string()).optional().describe('Only show commits touching these paths.'),
  ref: z.string().optional().describe('Branch, tag, or revision range. Defaults to HEAD.'),
});

const SEP = '\x1f';
const FMT = `%H${SEP}%s${SEP}%an${SEP}%ad`;

export const gitLogTool: ToolDef<
  typeof params,
  {
    entries: Array<{ sha: string; subject: string; author: string; date: string }>;
    raw: string;
  }
> = {
  name: 'git.log',
  description: 'Show commit history (SHA, subject, author, date). Tier 0 — read-only.',
  minTier: TIER.READ_ONLY,
  parameters: params,
  async execute(args, ctx) {
    const cwdRaw = args.cwd ?? ctx.projectRoots[0];
    if (!cwdRaw) throw new Error('No project root configured.');
    const cwd = assertInsideRoots(cwdRaw, ctx.projectRoots);

    if (args.ref && args.ref.startsWith('-')) {
      throw new Error(`Refusing suspicious ref: ${args.ref}`);
    }

    const argv = ['log', `--pretty=format:${FMT}`, '--date=iso', '-n', String(args.limit)];
    if (args.ref) argv.push(args.ref);
    if (args.paths && args.paths.length > 0) {
      argv.push('--');
      for (const p of args.paths) {
        assertInsideRoots(p, ctx.projectRoots);
        argv.push(p);
      }
    }

    const res = await runCommand('git', argv, {
      cwd,
      timeoutMs: 30_000,
      maxOutputBytes: 2_000_000,
      env: buildScrubbedEnv(),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });
    if (res.exitCode !== 0) {
      throw new Error(`git log failed (exit ${res.exitCode}): ${res.stderr.slice(0, 500)}`);
    }
    const entries = res.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha, subject, author, date] = line.split(SEP);
        return {
          sha: sha ?? '',
          subject: subject ?? '',
          author: author ?? '',
          date: date ?? '',
        };
      });
    return { entries, raw: res.stdout };
  },
};

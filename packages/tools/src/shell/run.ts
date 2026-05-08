import { TIER } from '@agent/shared';
import { z } from 'zod';
import { assertInsideRoots } from '../scoping.js';
import { buildScrubbedEnv, runCommand } from '../proc.js';
import type { ToolDef } from '../types.js';
import { DEFAULT_SHELL_ALLOWLIST, matchAllowlist, type ShellAllowEntry } from './allowlist.js';

const params = z.object({
  command: z.string().min(1).describe('The program to execute (e.g. "pnpm"). No shell, no interpolation.'),
  args: z.array(z.string()).optional().default([]).describe('Positional arguments, passed as argv (no shell).'),
  cwd: z.string().optional().describe('Working directory. Must be inside a project root. Defaults to first root.'),
  timeoutMs: z.number().int().min(1_000).max(600_000).optional().default(60_000),
});

export interface ShellResult {
  command: string;
  args: string[];
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  matched: string | null;
}

export function buildShellTool(allowlist: readonly ShellAllowEntry[] = DEFAULT_SHELL_ALLOWLIST): ToolDef<
  typeof params,
  ShellResult
> {
  return {
    name: 'shell.run',
    description:
      'Run an allowlisted command in the workspace. Matching is argv-based, not regex — the command + argv prefix must match an entry in the structured allowlist. Tier 3 (Safe commands).',
    minTier: TIER.SAFE_COMMANDS,
    parameters: params,
    async buildPreview(args, _ctx) {
      return {
        kind: 'text',
        content: `$ ${args.command} ${(args.args ?? []).join(' ')}\n(cwd: ${args.cwd ?? '<first project root>'})\ntimeout: ${args.timeoutMs ?? 60_000}ms`,
      };
    },
    async execute(args, ctx) {
      const cwdRaw = args.cwd ?? ctx.projectRoots[0];
      if (!cwdRaw) throw new Error('No project root configured.');
      const cwd = assertInsideRoots(cwdRaw, ctx.projectRoots);

      // Hard reject shell metacharacters in command name (defence-in-depth).
      if (/[;&|`$<>\n\r"']/.test(args.command)) {
        throw new Error(`Command name contains unsafe characters: ${args.command}`);
      }

      const match = matchAllowlist(args.command, args.args, allowlist);
      if (!match.allowed) {
        throw new Error(match.reason ?? 'Command not in allowlist.');
      }

      const res = await runCommand(args.command, args.args, {
        cwd,
        timeoutMs: args.timeoutMs,
        maxOutputBytes: 2_000_000,
        env: buildScrubbedEnv(),
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });

      return {
        command: args.command,
        args: [...args.args],
        cwd,
        exitCode: res.exitCode,
        stdout: res.stdout,
        stderr: res.stderr,
        timedOut: res.timedOut,
        truncated: res.truncated,
        matched: match.entry ? `${match.entry.cmd} ${match.entry.args.join(' ')}`.trim() : null,
      };
    },
  };
}

export const shellTool = buildShellTool();

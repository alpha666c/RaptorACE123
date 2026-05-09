import { TIER } from '@agent/shared';
import { z } from 'zod';
import { assertInsideRoots } from '../scoping.js';
import { buildScrubbedEnv, runCommand } from '../proc.js';
import type { ToolDef } from '../types.js';
import type { ShellResult } from './run.js';

const params = z.object({
  command: z.string().min(1).describe('Program to execute. No shell, no string interpolation.'),
  args: z
    .array(z.string())
    .optional()
    .default([])
    .describe('Positional arguments, passed as argv (no shell). Use `args: ["-c", "…"]` with `command: "bash"` when you need a shell pipeline.'),
  cwd: z.string().optional().describe('Working directory. Must resolve inside a project root.'),
  timeoutMs: z.number().int().min(1_000).max(900_000).optional().default(120_000),
});

/**
 * Unrestricted terminal tool. Unlike `shell.run`, this does NOT consult the
 * argv allowlist — any command is allowed, subject to approval at tier 4.
 *
 * Purpose: give the user terminal-equivalent access through the agent when
 * they're working inside a browser-based Codespace or otherwise can't easily
 * drop into their own shell. The approval prompt is the safety net — Viktor
 * sees the exact argv and cwd before the command runs.
 *
 * Still enforced:
 *  - cwd must resolve inside a project root
 *  - argv-only execution (no shell string; no metachar interpolation from us)
 *  - scrubbed env (no token leakage to subprocesses beyond PATH/HOME/LANG/…)
 *  - hard timeout and output cap
 *  - abort signal honoured
 */
export const shellExecTool: ToolDef<typeof params, ShellResult> = {
  name: 'shell.exec',
  description:
    'Run an arbitrary command (argv-form) in the workspace. No allowlist — approval at tier 4 is the gate. Use this when `shell.run` rejects a legitimate command you need. For shell pipelines pass `command: "bash"` with `args: ["-c", "<pipeline>"]`.',
  minTier: TIER.BROADER_COMMANDS,
  parameters: params,
  async buildPreview(args) {
    const argStr = (args.args ?? []).map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ');
    return {
      kind: 'text',
      content: `$ ${args.command}${argStr ? ` ${argStr}` : ''}\n(cwd: ${args.cwd ?? '<first project root>'})\ntimeout: ${args.timeoutMs ?? 120_000}ms`,
    };
  },
  async execute(args, ctx) {
    const cwdRaw = args.cwd ?? ctx.projectRoots[0];
    if (!cwdRaw) throw new Error('No project root configured.');
    const cwd = assertInsideRoots(cwdRaw, ctx.projectRoots);

    if (/[;&|`$<>\n\r"']/.test(args.command)) {
      throw new Error(`Command name contains unsafe characters: ${args.command}`);
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
      matched: null,
    };
  },
};

import { execFile } from 'node:child_process';

export interface ProcResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  truncated: boolean;
}

export interface RunOptions {
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  stdin?: string;
}

/**
 * Run an external command using execFile (no shell interpretation).
 * Caps stdout/stderr at `maxOutputBytes`, enforces a hard timeout, and
 * reports timeout/truncation in the result rather than throwing.
 */
export function runCommand(cmd: string, args: readonly string[], opts: RunOptions): Promise<ProcResult> {
  return new Promise((resolve) => {
    const child = execFile(cmd, args as string[], {
      cwd: opts.cwd,
      env: opts.env,
      timeout: opts.timeoutMs,
      maxBuffer: opts.maxOutputBytes,
      encoding: 'utf8',
      windowsHide: true,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });

    // execFile's `timeout` sends SIGTERM, which long-lived daemons (MCP servers,
    // `npx` installing a server, etc.) ignore. Escalate to SIGKILL 5s later so
    // the shell tool can't hang the agent for an unbounded time.
    const forceKillTimer = setTimeout(() => {
      if (child.exitCode === null && !child.killed) {
        try {
          child.kill('SIGKILL');
        } catch {
          // child may have exited between the check and the kill; best-effort
        }
      }
    }, opts.timeoutMs + 5_000);
    forceKillTimer.unref?.();

    let stdout = '';
    let stderr = '';
    let truncated = false;
    let timedOut = false;

    child.stdout?.on('data', (d: Buffer | string) => {
      const s = typeof d === 'string' ? d : d.toString('utf8');
      if (stdout.length + s.length > opts.maxOutputBytes) {
        stdout += s.slice(0, opts.maxOutputBytes - stdout.length);
        truncated = true;
      } else {
        stdout += s;
      }
    });
    child.stderr?.on('data', (d: Buffer | string) => {
      const s = typeof d === 'string' ? d : d.toString('utf8');
      if (stderr.length + s.length > opts.maxOutputBytes) {
        stderr += s.slice(0, opts.maxOutputBytes - stderr.length);
        truncated = true;
      } else {
        stderr += s;
      }
    });

    if (opts.stdin !== undefined && child.stdin) {
      child.stdin.write(opts.stdin);
      child.stdin.end();
    }

    child.on('close', (code, sig) => {
      clearTimeout(forceKillTimer);
      timedOut = sig === 'SIGTERM' || sig === 'SIGKILL';
      resolve({ stdout, stderr, exitCode: code ?? -1, timedOut, truncated });
    });
    child.on('error', (err) => {
      clearTimeout(forceKillTimer);
      resolve({
        stdout,
        stderr: stderr + `\n[spawn error] ${(err as Error).message}`,
        exitCode: -1,
        timedOut,
        truncated,
      });
    });
  });
}

/** Build a minimal scrubbed environment for subprocess runs. */
export function buildScrubbedEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = {
    PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: process.env['HOME'] ?? '',
    LANG: process.env['LANG'] ?? 'en_US.UTF-8',
    LC_ALL: process.env['LC_ALL'] ?? 'en_US.UTF-8',
    TERM: 'dumb',
    CI: '1',
    NO_COLOR: '1',
  };
  return extra ? { ...base, ...extra } : base;
}

import { describe, expect, it } from 'vitest';
import { DEFAULT_SHELL_ALLOWLIST, matchAllowlist } from '../src/shell/allowlist.js';

describe('shell allowlist — argv matching', () => {
  it('matches `pnpm test`', () => {
    const r = matchAllowlist('pnpm', ['test'], DEFAULT_SHELL_ALLOWLIST);
    expect(r.allowed).toBe(true);
  });

  it('matches `pnpm test --filter X` because extra args are allowed', () => {
    const r = matchAllowlist('pnpm', ['test', '--filter', 'X'], DEFAULT_SHELL_ALLOWLIST);
    expect(r.allowed).toBe(true);
  });

  it('matches `pnpm -C packages/tools test`', () => {
    const r = matchAllowlist('pnpm', ['-C', 'packages/tools', 'test'], DEFAULT_SHELL_ALLOWLIST);
    expect(r.allowed).toBe(true);
  });

  it('rejects `rm -rf /`', () => {
    const r = matchAllowlist('rm', ['-rf', '/'], DEFAULT_SHELL_ALLOWLIST);
    expect(r.allowed).toBe(false);
  });

  it('rejects `pnpm publish` (not in allowlist)', () => {
    const r = matchAllowlist('pnpm', ['publish'], DEFAULT_SHELL_ALLOWLIST);
    expect(r.allowed).toBe(false);
  });

  it('rejects a command not in the allowlist even if args look benign', () => {
    const r = matchAllowlist('curl', ['https://example.com'], DEFAULT_SHELL_ALLOWLIST);
    expect(r.allowed).toBe(false);
  });

  it('argv matching is not fooled by concatenated args', () => {
    // Someone trying to smuggle "rm -rf" by mashing into one arg — argv treats it
    // as a single arg and looks for a matching entry with that literal.
    const r = matchAllowlist('ls', ['; rm -rf /'], DEFAULT_SHELL_ALLOWLIST);
    // `ls` with any extra args is allowed, but the "arg" is passed as one opaque
    // positional — no shell, so nothing executes as a second command. Allowed, safe.
    expect(r.allowed).toBe(true);
  });

  it('strict entries (allowExtraArgs=false) require exact match', () => {
    const strict = [{ cmd: 'git', args: ['status'], allowExtraArgs: false }];
    expect(matchAllowlist('git', ['status'], strict).allowed).toBe(true);
    expect(matchAllowlist('git', ['status', '--porcelain'], strict).allowed).toBe(false);
  });
});

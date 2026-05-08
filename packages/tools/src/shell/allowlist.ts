/**
 * Structured argv allowlist for the shell tool. Each entry matches a specific
 * command + fixed prefix args; `allowExtraArgs` controls whether additional
 * trailing args are allowed. Regex is deliberately NOT used — argv matching is
 * unambiguous and the error messages are clearer when matching fails.
 */
export interface ShellAllowEntry {
  cmd: string;
  /** Fixed prefix args that must match exactly. */
  args: readonly string[];
  /** If true, any additional args after the prefix are allowed. */
  allowExtraArgs: boolean;
  /** Optional human description for UI / approval prompts. */
  description?: string;
}

export const DEFAULT_SHELL_ALLOWLIST: ShellAllowEntry[] = [
  { cmd: 'pnpm', args: ['install'], allowExtraArgs: true, description: 'Install dependencies' },
  { cmd: 'pnpm', args: ['test'], allowExtraArgs: true, description: 'Run tests' },
  { cmd: 'pnpm', args: ['build'], allowExtraArgs: true, description: 'Build' },
  { cmd: 'pnpm', args: ['typecheck'], allowExtraArgs: true, description: 'Typecheck' },
  { cmd: 'pnpm', args: ['lint'], allowExtraArgs: true, description: 'Lint' },
  { cmd: 'pnpm', args: ['format'], allowExtraArgs: true, description: 'Format' },
  { cmd: 'pnpm', args: ['-C'], allowExtraArgs: true, description: 'Run pnpm in a workspace package' },
  { cmd: 'pnpm', args: ['-r'], allowExtraArgs: true, description: 'Recursive pnpm' },
  { cmd: 'npm', args: ['install'], allowExtraArgs: true },
  { cmd: 'npm', args: ['test'], allowExtraArgs: true },
  { cmd: 'npm', args: ['run'], allowExtraArgs: true },
  { cmd: 'npx', args: [], allowExtraArgs: true, description: 'Invoke a package bin' },
  { cmd: 'tsc', args: [], allowExtraArgs: true, description: 'TypeScript compile' },
  { cmd: 'node', args: ['--version'], allowExtraArgs: false },
  { cmd: 'node', args: ['-e'], allowExtraArgs: true, description: 'Execute a Node one-liner' },
  { cmd: 'ls', args: [], allowExtraArgs: true },
  { cmd: 'cat', args: [], allowExtraArgs: true },
];

export interface MatchResult {
  allowed: boolean;
  entry?: ShellAllowEntry;
  reason?: string;
}

export function matchAllowlist(cmd: string, args: readonly string[], allowlist: readonly ShellAllowEntry[]): MatchResult {
  for (const entry of allowlist) {
    if (entry.cmd !== cmd) continue;
    if (args.length < entry.args.length) continue;
    let prefixOk = true;
    for (let i = 0; i < entry.args.length; i++) {
      if (entry.args[i] !== args[i]) {
        prefixOk = false;
        break;
      }
    }
    if (!prefixOk) continue;
    if (!entry.allowExtraArgs && args.length !== entry.args.length) continue;
    return { allowed: true, entry };
  }
  return {
    allowed: false,
    reason: `No allowlist entry matches: ${cmd} ${args.join(' ')}. Matching is argv-based (no shell).`,
  };
}

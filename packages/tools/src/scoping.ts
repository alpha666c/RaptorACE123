import * as fs from 'node:fs';
import * as path from 'node:path';

export class ScopingError extends Error {
  constructor(
    message: string,
    readonly details: { requested: string; roots: readonly string[] },
  ) {
    super(message);
    this.name = 'ScopingError';
  }
}

/** NFC-normalize a path string to defeat macOS HFS+/APFS unicode tricks. */
function nfc(s: string): string {
  return s.normalize('NFC');
}

/**
 * Realpath the nearest existing ancestor, then append the remainder.
 * This lets us scope-check a path that we're about to create (file write).
 * If the path exists, this is identical to realpathSync.
 */
function realpathAllowMissing(absPath: string): string {
  const parts = absPath.split(path.sep);
  for (let i = parts.length; i >= 0; i--) {
    const prefix = parts.slice(0, i).join(path.sep) || path.sep;
    try {
      const real = fs.realpathSync.native(prefix);
      const remainder = parts.slice(i).join(path.sep);
      return remainder ? path.join(real, remainder) : real;
    } catch {
      // climb up
    }
  }
  return absPath;
}

/**
 * Assert that `requested` resolves to a location inside one of `roots`.
 * Returns the fully-resolved absolute path on success.
 * Throws ScopingError otherwise.
 *
 * Enforces:
 *  - Input must be a non-empty string.
 *  - Rejects null bytes.
 *  - Resolves via realpath (follows symlinks — symlink-out is blocked).
 *  - NFC-normalizes both sides to defeat unicode normalization tricks.
 *  - Requires strict prefix match with a separator boundary (no "/a/b" matching root "/a/bb").
 *  - Works for paths that don't yet exist (finds nearest existing ancestor).
 */
export function assertInsideRoots(requested: string, roots: readonly string[]): string {
  if (typeof requested !== 'string' || requested.length === 0) {
    throw new ScopingError('Path must be a non-empty string.', { requested: String(requested), roots });
  }
  if (requested.includes('\0')) {
    throw new ScopingError('Path contains a null byte.', { requested, roots });
  }
  if (roots.length === 0) {
    throw new ScopingError('No project roots are configured.', { requested, roots });
  }

  // Relative paths resolve against the first project root, not cwd — the agent's
  // "current directory" is the workspace, not whichever directory Node happened
  // to start in. `roots[0]` is guaranteed by the length check above.
  const firstRoot = roots[0] as string;
  const absPath = path.isAbsolute(requested) ? requested : path.resolve(firstRoot, requested);
  const normalizedTarget = nfc(realpathAllowMissing(absPath));

  for (const root of roots) {
    if (!path.isAbsolute(root)) {
      throw new ScopingError(`Root must be absolute: ${root}`, { requested, roots });
    }
    let normalizedRoot: string;
    try {
      normalizedRoot = nfc(fs.realpathSync.native(root));
    } catch {
      // Root itself does not exist — skip it. Do not fall through silently.
      continue;
    }
    if (normalizedTarget === normalizedRoot) return normalizedTarget;
    const withSep = normalizedRoot.endsWith(path.sep) ? normalizedRoot : normalizedRoot + path.sep;
    if (normalizedTarget.startsWith(withSep)) return normalizedTarget;
  }

  throw new ScopingError(
    `Path is outside the approved project roots: ${requested}`,
    { requested, roots },
  );
}

/** Non-throwing variant. Returns null if outside scope. */
export function tryInsideRoots(requested: string, roots: readonly string[]): string | null {
  try {
    return assertInsideRoots(requested, roots);
  } catch (e) {
    if (e instanceof ScopingError) return null;
    throw e;
  }
}

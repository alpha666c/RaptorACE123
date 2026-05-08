import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ScopingError, assertInsideRoots, tryInsideRoots } from '../src/scoping.js';

/**
 * Attack-vector suite for project-root scoping.
 * These must all pass before any write-capable tool ships.
 */

let tmpRoot: string;
let projectRoot: string;
let outsideDir: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-scoping-'));
  projectRoot = fs.realpathSync(fs.mkdtempSync(path.join(tmpRoot, 'proj-')));
  outsideDir = fs.realpathSync(fs.mkdtempSync(path.join(tmpRoot, 'outside-')));
  fs.writeFileSync(path.join(projectRoot, 'ok.txt'), 'inside');
  fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'outside');
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('assertInsideRoots — basic allow/deny', () => {
  it('allows a direct child file', () => {
    const p = path.join(projectRoot, 'ok.txt');
    expect(assertInsideRoots(p, [projectRoot])).toBe(p);
  });

  it('allows the root itself', () => {
    expect(assertInsideRoots(projectRoot, [projectRoot])).toBe(projectRoot);
  });

  it('allows a nested path that does not yet exist', () => {
    const p = path.join(projectRoot, 'a', 'b', 'c.txt');
    expect(assertInsideRoots(p, [projectRoot])).toBe(p);
  });

  it('denies a sibling directory', () => {
    expect(() => assertInsideRoots(outsideDir, [projectRoot])).toThrow(ScopingError);
  });

  it('denies an unrelated absolute path', () => {
    expect(() => assertInsideRoots('/etc/passwd', [projectRoot])).toThrow(ScopingError);
  });
});

describe('assertInsideRoots — traversal attacks', () => {
  it('denies .. traversal out of root', () => {
    const p = path.join(projectRoot, '..', path.basename(outsideDir), 'secret.txt');
    expect(() => assertInsideRoots(p, [projectRoot])).toThrow(ScopingError);
  });

  it('denies .. that walks through root back up', () => {
    const p = path.join(projectRoot, 'a', '..', '..', path.basename(outsideDir));
    expect(() => assertInsideRoots(p, [projectRoot])).toThrow(ScopingError);
  });

  it('denies doubled slashes + dots', () => {
    const p = `${projectRoot}//..//${path.basename(outsideDir)}`;
    expect(() => assertInsideRoots(p, [projectRoot])).toThrow(ScopingError);
  });
});

describe('assertInsideRoots — symlink attacks', () => {
  it('denies a symlink inside the root pointing outside', () => {
    const linkPath = path.join(projectRoot, 'escape-link');
    fs.symlinkSync(outsideDir, linkPath);
    const attack = path.join(linkPath, 'secret.txt');
    expect(() => assertInsideRoots(attack, [projectRoot])).toThrow(ScopingError);
  });

  it('denies a file-symlink to an outside file', () => {
    const linkPath = path.join(projectRoot, 'escape-file');
    fs.symlinkSync(path.join(outsideDir, 'secret.txt'), linkPath);
    expect(() => assertInsideRoots(linkPath, [projectRoot])).toThrow(ScopingError);
  });

  it('allows a symlink inside the root pointing to another inside file', () => {
    const inner = path.join(projectRoot, 'inner.txt');
    fs.writeFileSync(inner, 'x');
    const linkPath = path.join(projectRoot, 'inside-link');
    fs.symlinkSync(inner, linkPath);
    expect(() => assertInsideRoots(linkPath, [projectRoot])).not.toThrow();
  });
});

describe('assertInsideRoots — boundary tricks', () => {
  it('denies a sibling root with a common prefix', () => {
    const sibling = fs.realpathSync(fs.mkdtempSync(path.join(tmpRoot, `${path.basename(projectRoot)}-extra-`)));
    // `sibling` starts with `${projectRoot}-extra-...` — NOT inside projectRoot.
    expect(() => assertInsideRoots(sibling, [projectRoot])).toThrow(ScopingError);
  });

  it('resolves relative paths against the first project root, not cwd', () => {
    // Agent-friendly: `src/foo.ts` means "<firstRoot>/src/foo.ts", not cwd-relative.
    expect(assertInsideRoots('child.txt', [projectRoot])).toBe(
      path.join(projectRoot, 'child.txt'),
    );
    expect(assertInsideRoots('deep/nested/file.ts', [projectRoot])).toBe(
      path.join(projectRoot, 'deep/nested/file.ts'),
    );
  });

  it('still rejects relative paths with .. that escape the first root', () => {
    const sibling = fs.realpathSync(fs.mkdtempSync(path.join(tmpRoot, 'sib-')));
    // `../<sibling>/secret.txt` resolves outside projectRoot.
    const attack = `../${path.basename(sibling)}/secret.txt`;
    expect(() => assertInsideRoots(attack, [projectRoot])).toThrow(ScopingError);
  });
});

describe('assertInsideRoots — input hardening', () => {
  it('throws on empty string', () => {
    expect(() => assertInsideRoots('', [projectRoot])).toThrow(ScopingError);
  });

  it('throws on null byte', () => {
    expect(() => assertInsideRoots(`${projectRoot}/x\0.txt`, [projectRoot])).toThrow(ScopingError);
  });

  it('throws when roots list is empty', () => {
    expect(() => assertInsideRoots(path.join(projectRoot, 'ok.txt'), [])).toThrow(ScopingError);
  });

  it('throws when a root is not absolute', () => {
    expect(() => assertInsideRoots(path.join(projectRoot, 'ok.txt'), ['./relative'])).toThrow(ScopingError);
  });

  it('skips non-existent roots without silently allowing anything', () => {
    const ghostRoot = path.join(tmpRoot, 'does-not-exist');
    expect(() => assertInsideRoots(path.join(projectRoot, 'ok.txt'), [ghostRoot, projectRoot])).not.toThrow();
    expect(() => assertInsideRoots(outsideDir, [ghostRoot])).toThrow(ScopingError);
  });
});

describe('assertInsideRoots — unicode', () => {
  it('treats NFC and NFD forms of the same path consistently', () => {
    // 'café' in NFC (é = U+00E9) vs NFD (e + U+0301)
    const nameNFC = 'café';
    const nameNFD = 'café';
    const fullNFC = path.join(projectRoot, nameNFC, 'x.txt');
    const fullNFD = path.join(projectRoot, nameNFD, 'x.txt');
    expect(() => assertInsideRoots(fullNFC, [projectRoot])).not.toThrow();
    expect(() => assertInsideRoots(fullNFD, [projectRoot])).not.toThrow();
  });
});

describe('tryInsideRoots', () => {
  it('returns the resolved path on allow', () => {
    const p = path.join(projectRoot, 'ok.txt');
    expect(tryInsideRoots(p, [projectRoot])).toBe(p);
  });

  it('returns null on deny', () => {
    expect(tryInsideRoots('/etc/passwd', [projectRoot])).toBeNull();
  });
});

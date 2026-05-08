import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { TIER } from '@agent/shared';
import { z } from 'zod';
import { assertInsideRoots } from '../scoping.js';
import type { ToolDef } from '../types.js';

const params = z.object({
  path: z.string().min(1).describe('Absolute or workspace-relative path of the file to write.'),
  content: z.string().describe('Full file content to write. Overwrites existing file.'),
  createDirs: z.boolean().optional().default(true).describe('Create parent directories if missing.'),
});

export const writeFileTool: ToolDef<typeof params, { path: string; bytesWritten: number; created: boolean }> = {
  name: 'fs.write',
  description: 'Write a file in the workspace. Overwrites any existing content. Requires tier EDIT_FILES.',
  minTier: TIER.EDIT_FILES,
  parameters: params,
  async buildPreview(args, ctx) {
    const absPath = assertInsideRoots(args.path, ctx.projectRoots);
    let before = '';
    let exists = true;
    try {
      before = await fs.readFile(absPath, 'utf8');
    } catch {
      exists = false;
    }
    const header = exists ? `--- ${absPath} (current)\n+++ ${absPath} (proposed)\n` : `+++ ${absPath} (new file)\n`;
    const diff = simpleDiff(before, args.content);
    return { kind: 'diff', content: header + diff };
  },
  async execute(args, ctx) {
    const absPath = assertInsideRoots(args.path, ctx.projectRoots);
    let existed = true;
    try {
      await fs.access(absPath);
    } catch {
      existed = false;
    }
    if (args.createDirs) {
      await fs.mkdir(path.dirname(absPath), { recursive: true });
    }
    const bytes = Buffer.byteLength(args.content, 'utf8');
    await fs.writeFile(absPath, args.content, 'utf8');
    return { path: absPath, bytesWritten: bytes, created: !existed };
  },
};

function simpleDiff(a: string, b: string): string {
  const al = a.split('\n');
  const bl = b.split('\n');
  const out: string[] = [];
  const max = Math.max(al.length, bl.length);
  for (let i = 0; i < max; i++) {
    const x = al[i];
    const y = bl[i];
    if (x === y) {
      if (x !== undefined) out.push(`  ${x}`);
    } else {
      if (x !== undefined) out.push(`- ${x}`);
      if (y !== undefined) out.push(`+ ${y}`);
    }
  }
  return out.join('\n');
}

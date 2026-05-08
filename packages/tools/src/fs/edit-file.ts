import * as fs from 'node:fs/promises';
import { TIER } from '@agent/shared';
import { z } from 'zod';
import { assertInsideRoots } from '../scoping.js';
import type { ToolDef } from '../types.js';

const params = z.object({
  path: z.string().min(1),
  oldString: z.string().min(1).describe('Exact text to replace. Must match the file exactly.'),
  newString: z.string().describe('Replacement text.'),
  replaceAll: z.boolean().optional().default(false),
});

export const editFileTool: ToolDef<
  typeof params,
  { path: string; replacements: number; bytesBefore: number; bytesAfter: number }
> = {
  name: 'fs.edit',
  description:
    'Replace an exact substring in an existing file. Fails if the oldString is not unique unless replaceAll=true. Requires tier EDIT_FILES.',
  minTier: TIER.EDIT_FILES,
  parameters: params,
  async buildPreview(args, ctx) {
    const absPath = assertInsideRoots(args.path, ctx.projectRoots);
    const before = await fs.readFile(absPath, 'utf8');
    const after = applyEdit(before, args);
    return { kind: 'diff', content: buildDiff(absPath, before, after) };
  },
  async execute(args, ctx) {
    const absPath = assertInsideRoots(args.path, ctx.projectRoots);
    const before = await fs.readFile(absPath, 'utf8');
    const after = applyEdit(before, args);
    const occurrences = countOccurrences(before, args.oldString);
    await fs.writeFile(absPath, after, 'utf8');
    return {
      path: absPath,
      replacements: args.replaceAll ? occurrences : occurrences > 0 ? 1 : 0,
      bytesBefore: Buffer.byteLength(before, 'utf8'),
      bytesAfter: Buffer.byteLength(after, 'utf8'),
    };
  },
};

function applyEdit(content: string, args: z.infer<typeof params>): string {
  const count = countOccurrences(content, args.oldString);
  if (count === 0) {
    throw new Error('oldString not found in file.');
  }
  if (!args.replaceAll && count > 1) {
    throw new Error(`oldString appears ${count} times; pass replaceAll=true or provide more context to make it unique.`);
  }
  if (args.replaceAll) {
    return content.split(args.oldString).join(args.newString);
  }
  const idx = content.indexOf(args.oldString);
  return content.slice(0, idx) + args.newString + content.slice(idx + args.oldString.length);
}

function countOccurrences(content: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = content.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

function buildDiff(path: string, before: string, after: string): string {
  const al = before.split('\n');
  const bl = after.split('\n');
  const out: string[] = [`--- ${path} (current)`, `+++ ${path} (proposed)`];
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

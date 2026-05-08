import * as fs from 'node:fs/promises';
import { TIER } from '@agent/shared';
import { z } from 'zod';
import { assertInsideRoots } from '../scoping.js';
import type { ToolDef } from '../types.js';

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB cap per read

const params = z.object({
  path: z.string().min(1).describe('Absolute or workspace-relative path to the file to read.'),
  offset: z.number().int().min(0).optional().describe('Byte offset to start from. Defaults to 0.'),
  limit: z.number().int().min(1).max(MAX_BYTES).optional().describe('Maximum bytes to read. Defaults to 2MB cap.'),
});

export const readFileTool: ToolDef<typeof params, { path: string; content: string; truncated: boolean }> = {
  name: 'fs.read',
  description: 'Read a file from the workspace. Returns UTF-8 text. Binary files are rejected. Capped at 2MB.',
  minTier: TIER.READ_ONLY,
  parameters: params,
  async execute(args, ctx) {
    const absPath = assertInsideRoots(args.path, ctx.projectRoots);
    const handle = await fs.open(absPath, 'r');
    try {
      const stat = await handle.stat();
      if (stat.size === 0) return { path: absPath, content: '', truncated: false };
      const offset = args.offset ?? 0;
      const limit = Math.min(args.limit ?? MAX_BYTES, MAX_BYTES, stat.size - offset);
      const buf = Buffer.alloc(limit);
      const { bytesRead } = await handle.read(buf, 0, limit, offset);
      const sliced = buf.subarray(0, bytesRead);
      if (sliced.includes(0)) {
        throw new Error(`Refusing to read binary file: ${absPath}`);
      }
      return {
        path: absPath,
        content: sliced.toString('utf8'),
        truncated: offset + bytesRead < stat.size,
      };
    } finally {
      await handle.close();
    }
  },
};

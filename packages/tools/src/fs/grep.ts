import fg from 'fast-glob';
import * as fs from 'node:fs/promises';
import { TIER } from '@agent/shared';
import { z } from 'zod';
import { assertInsideRoots } from '../scoping.js';
import type { ToolDef } from '../types.js';

const params = z.object({
  query: z.string().min(1).describe('Regex pattern to search for.'),
  pattern: z.string().optional().default('**/*').describe('Glob to narrow files searched.'),
  cwd: z.string().optional(),
  caseInsensitive: z.boolean().optional().default(false),
  maxResults: z.number().int().min(1).max(500).optional().default(100),
});

interface Match {
  path: string;
  line: number;
  text: string;
}

export const grepTool: ToolDef<typeof params, { matches: Match[]; truncated: boolean }> = {
  name: 'fs.grep',
  description: 'Search files in the workspace with a regex. Returns matching lines with file + line number.',
  minTier: TIER.READ_ONLY,
  parameters: params,
  async execute(args, ctx) {
    const cwdRaw = args.cwd ?? ctx.projectRoots[0];
    if (!cwdRaw) throw new Error('No project root configured.');
    const cwd = assertInsideRoots(cwdRaw, ctx.projectRoots);
    let re: RegExp;
    try {
      re = new RegExp(args.query, args.caseInsensitive ? 'i' : '');
    } catch (e) {
      throw new Error(`Invalid regex: ${(e as Error).message}`);
    }
    const files = await fg(args.pattern, {
      cwd,
      absolute: true,
      followSymbolicLinks: false,
      dot: false,
      onlyFiles: true,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/out/**'],
    });

    const matches: Match[] = [];
    for (const file of files) {
      let scoped: string;
      try {
        scoped = assertInsideRoots(file, ctx.projectRoots);
      } catch {
        continue;
      }
      let content: string;
      try {
        content = await fs.readFile(scoped, 'utf8');
      } catch {
        continue;
      }
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === undefined) continue;
        if (re.test(line)) {
          matches.push({ path: scoped, line: i + 1, text: line.slice(0, 500) });
          if (matches.length >= args.maxResults) {
            return { matches, truncated: true };
          }
        }
      }
    }
    return { matches, truncated: false };
  },
};

import fg from 'fast-glob';
import { TIER } from '@agent/shared';
import { z } from 'zod';
import { assertInsideRoots } from '../scoping.js';
import type { ToolDef } from '../types.js';

const params = z.object({
  pattern: z.string().min(1).describe('Glob pattern, e.g. "src/**/*.ts".'),
  cwd: z.string().optional().describe('Absolute directory to search in. Must be inside a project root.'),
  limit: z.number().int().min(1).max(10_000).optional().default(1000),
});

export const globTool: ToolDef<typeof params, { matches: string[]; truncated: boolean }> = {
  name: 'fs.glob',
  description: 'Find files matching a glob pattern inside the workspace.',
  minTier: TIER.READ_ONLY,
  parameters: params,
  async execute(args, ctx) {
    const cwdRaw = args.cwd ?? ctx.projectRoots[0];
    if (!cwdRaw) throw new Error('No project root configured.');
    const cwd = assertInsideRoots(cwdRaw, ctx.projectRoots);
    const results = await fg(args.pattern, {
      cwd,
      absolute: true,
      followSymbolicLinks: false,
      dot: false,
      onlyFiles: true,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/out/**'],
    });
    const safeMatches = results
      .map((p) => {
        try {
          return assertInsideRoots(p, ctx.projectRoots);
        } catch {
          return null;
        }
      })
      .filter((p): p is string => p !== null);
    const limited = safeMatches.slice(0, args.limit);
    return { matches: limited, truncated: limited.length < safeMatches.length };
  },
};

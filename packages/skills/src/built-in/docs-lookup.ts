import { SkillManifestSchema } from '../manifest.js';
import type { Skill } from '../types.js';

/**
 * Pre-turn skill: when the user asks about a library/framework/API, nudge the
 * model toward Context7 MCP tools (mcp__context7__resolve-library-id +
 * mcp__context7__query-docs) rather than answering from its training data
 * which goes stale.
 */
export const docsLookupSkill: Skill = {
  manifest: SkillManifestSchema.parse({
    name: 'docs-lookup',
    version: '0.1.0',
    description: 'Steers the model to use Context7 MCP for library/framework docs instead of training data.',
    responsibility: 'Keep library advice current by preferring live documentation over stale memory.',
    triggers: [{ type: 'pre-turn' }],
    minTier: 0,
  }),

  async onTurnStart(ctx, userMessage) {
    // Only nudge if Context7 is actually available — otherwise the hint misleads.
    const hasContext7 = ctx.registry.all().some((t) => t.name.startsWith('mcp__context7__'));
    if (!hasContext7) return null;

    const mentionsLibraryQuery =
      /\b(how (?:do|to) (?:use|configure|set up)|what(?:'s| is) the API|docs? for|latest version|new in|deprecat|migration|breaking change|react|next\.?js|vue|svelte|prisma|vercel ai sdk|express|tailwind|zod|drizzle|langchain|vite|esbuild|typescript|playwright|supabase|django|fastapi|spring|flutter)/i.test(
        userMessage,
      );
    if (!mentionsLibraryQuery) return null;

    return {
      promptAddition: `## Skill: docs-lookup
The user mentioned a library or framework. Your training data may be stale.
Prefer the mcp__context7__resolve-library-id + mcp__context7__query-docs tools
for authoritative current docs and code examples. Cite actual API signatures
from the returned docs, not recalled ones.`,
    };
  },
};

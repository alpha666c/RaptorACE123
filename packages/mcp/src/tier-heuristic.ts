import { TIER, type Tier } from '@agent/shared';
import type { McpServerConfig } from './config.js';

/**
 * Infer a permission tier for an MCP tool based on its name.
 * Used as a default when the server config doesn't specify a tier override.
 *
 * Precedence (highest to lowest):
 *   1. Per-tool override in `tierOverrides`.
 *   2. Server-wide `defaultTier`.
 *   3. Name-based heuristic: reads → 0, writes → 3, destructive → 6.
 */
export function inferTier(toolName: string, server: McpServerConfig): Tier {
  const override = server.tierOverrides[toolName];
  if (typeof override === 'number') return override as Tier;
  if (typeof server.defaultTier === 'number') return server.defaultTier as Tier;

  const lower = toolName.toLowerCase();

  // Destructive: anything that deletes or permanently changes state.
  if (/(^|[_-])(delete|destroy|drop|purge|remove|rm)([_-]|$)/.test(lower)) return TIER.DESTRUCTIVE;

  // Writes / mutations.
  if (
    /(^|[_-])(create|post|patch|update|put|edit|write|add|upload|move|archive|rename|send|execute|run|exec)([_-]|$)/.test(
      lower,
    )
  ) {
    return TIER.SAFE_COMMANDS;
  }

  // Reads / retrievals / searches.
  if (
    /(^|[_-])(get|retrieve|read|list|query|search|fetch|resolve|describe|show|view|stat|head)([_-]|$)/.test(
      lower,
    )
  ) {
    return TIER.READ_ONLY;
  }

  // Unknown verb → be conservative: require explicit approval (tier 1 = Suggest
  // requires approval in our current policy, which prompts the user).
  return TIER.SUGGEST;
}

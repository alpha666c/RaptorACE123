import { TIER, type Tier } from '@agent/shared';

/**
 * Per-session permission state. Not persisted.
 * Tier upgrades made for the session live here; the user can revert at any time.
 */
export class SessionPermissionStore {
  private currentTier: Tier = TIER.READ_ONLY;
  private sessionAllowedTools = new Set<string>();

  constructor(initial: Tier = TIER.READ_ONLY) {
    this.currentTier = initial;
  }

  getTier(): Tier {
    if (process.env['AGENT_READ_ONLY'] === '1') return TIER.READ_ONLY;
    return this.currentTier;
  }

  setTier(tier: Tier): void {
    this.currentTier = tier;
  }

  allowToolForSession(toolName: string): void {
    this.sessionAllowedTools.add(toolName);
  }

  isToolAllowedForSession(toolName: string): boolean {
    return this.sessionAllowedTools.has(toolName);
  }

  reset(): void {
    this.currentTier = TIER.READ_ONLY;
    this.sessionAllowedTools.clear();
  }
}

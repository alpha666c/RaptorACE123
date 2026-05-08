export const TIER = {
  READ_ONLY: 0,
  SUGGEST: 1,
  EDIT_FILES: 2,
  SAFE_COMMANDS: 3,
  BROADER_COMMANDS: 4,
  EXTERNAL_NETWORK: 5,
  DESTRUCTIVE: 6,
} as const;

export type Tier = (typeof TIER)[keyof typeof TIER];

export const TIER_NAMES: Record<Tier, string> = {
  0: 'Read-only',
  1: 'Suggest',
  2: 'Edit files',
  3: 'Safe commands',
  4: 'Broader commands',
  5: 'External network',
  6: 'Destructive',
};

export function tierName(t: Tier): string {
  return TIER_NAMES[t];
}

export * from './manifest.js';
export * from './types.js';
export * from './registry.js';
export * from './loader.js';
export * from './secret-scanner.js';
export * from './helpers.js';
export * from './built-in/index.js';

import { SkillRegistry } from './registry.js';
import { ALL_BUILT_IN_SKILLS } from './built-in/index.js';

/** Build a SkillRegistry preloaded with all 10 built-in skills. */
export function buildBuiltInSkillRegistry(): SkillRegistry {
  const reg = new SkillRegistry();
  for (const skill of ALL_BUILT_IN_SKILLS) {
    reg.register(skill);
  }
  return reg;
}

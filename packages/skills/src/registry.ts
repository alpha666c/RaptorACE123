import { getLogger } from '@agent/shared';
import type { ToolRegistry } from '@agent/tools';
import type { Skill } from './types.js';

const log = getLogger('skill-registry');

/**
 * Runtime registry of loaded skills. Owns the mapping from skill name → Skill
 * object and orchestrates skill hook dispatch. Not to be confused with
 * `ToolRegistry` — skills can register tools into that separately.
 */
export class SkillRegistry {
  private skills = new Map<string, Skill>();
  private disabled = new Set<string>();

  register(skill: Skill): void {
    if (this.skills.has(skill.manifest.name)) {
      throw new Error(`Skill ${skill.manifest.name} already registered.`);
    }
    this.skills.set(skill.manifest.name, skill);
    if (!skill.manifest.enabledByDefault) this.disabled.add(skill.manifest.name);
  }

  unregister(name: string): void {
    this.skills.delete(name);
    this.disabled.delete(name);
  }

  list(): Skill[] {
    return [...this.skills.values()];
  }

  enabled(): Skill[] {
    return this.list().filter((s) => !this.disabled.has(s.manifest.name));
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  setEnabled(name: string, enabled: boolean): void {
    if (enabled) this.disabled.delete(name);
    else this.disabled.add(name);
  }

  isEnabled(name: string): boolean {
    return this.skills.has(name) && !this.disabled.has(name);
  }

  /** Register every enabled skill's permanent tools into the given registry. */
  registerToolsInto(toolRegistry: ToolRegistry): void {
    for (const skill of this.enabled()) {
      const tools = skill.tools?.() ?? [];
      for (const t of tools) {
        if (!toolRegistry.has(t.name)) {
          toolRegistry.register(t);
          log.debug({ skill: skill.manifest.name, tool: t.name }, 'skill.tool.registered');
        }
      }
    }
  }
}

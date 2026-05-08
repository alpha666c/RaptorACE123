import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { getLogger } from '@agent/shared';
import { SkillManifestSchema, type SkillManifest } from './manifest.js';
import type { Skill } from './types.js';

const log = getLogger('skill-loader');

/**
 * Parse a user-authored `skill.yaml` into a validated manifest.
 * Returns null (and logs) on validation failure — invalid skills are skipped,
 * not fatal to the agent.
 */
export function parseManifestYaml(content: string, fromPath: string): SkillManifest | null {
  try {
    const parsed = parseYaml(content) as unknown;
    const manifest = SkillManifestSchema.parse(parsed);
    return manifest;
  } catch (e) {
    log.warn({ err: (e as Error).message, fromPath }, 'skill.manifest.invalid');
    return null;
  }
}

export interface DiscoveredSkill {
  manifest: SkillManifest;
  dir: string;
  entryPath: string;
}

/**
 * Scan a directory for user-authored skills. Looks for `<dir>/<skill>/skill.yaml`
 * paired with `<dir>/<skill>/index.js` (JavaScript entry; pre-compile TS yourself
 * if authoring in TS). The loader is deliberately conservative — malformed or
 * incomplete skills are skipped.
 *
 * This is file-discovery only. The caller is responsible for dynamically
 * importing the entry and wiring it into `SkillRegistry`.
 */
export function discoverUserSkills(rootDir: string): DiscoveredSkill[] {
  if (!fs.existsSync(rootDir)) return [];
  const found: DiscoveredSkill[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch (e) {
    log.warn({ err: (e as Error).message, rootDir }, 'skill.loader.readdir.failed');
    return [];
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(rootDir, entry.name);
    const manifestPath = path.join(dir, 'skill.yaml');
    const entryPath = path.join(dir, 'index.js');
    if (!fs.existsSync(manifestPath) || !fs.existsSync(entryPath)) continue;
    const content = fs.readFileSync(manifestPath, 'utf8');
    const manifest = parseManifestYaml(content, manifestPath);
    if (!manifest) continue;
    found.push({ manifest, dir, entryPath });
  }
  return found;
}

/**
 * Dynamically load a user-authored skill's entry file. The entry must export
 * a default value that's a `Skill` object. Returns null (and logs) if import
 * fails or the export shape is wrong — does NOT throw.
 */
export async function loadUserSkill(discovered: DiscoveredSkill): Promise<Skill | null> {
  try {
    const mod = (await import(discovered.entryPath)) as { default?: unknown };
    const candidate = mod.default;
    if (!candidate || typeof candidate !== 'object') {
      log.warn({ entryPath: discovered.entryPath }, 'skill.loader.no.default.export');
      return null;
    }
    const skill = candidate as Skill;
    // Make sure the entry's manifest matches (or overrides consistently) the YAML manifest.
    skill.manifest = discovered.manifest;
    return skill;
  } catch (e) {
    log.warn(
      { err: (e as Error).message, entryPath: discovered.entryPath },
      'skill.loader.import.failed',
    );
    return null;
  }
}

import { z } from 'zod';

/**
 * Per-plan schema for `skill.yaml`. Built-in skills define an inline manifest
 * matching this shape; user-authored skills ship a YAML file the loader parses.
 */
export const SkillTriggerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('intent'),
    match: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    type: z.literal('file-pattern'),
    match: z.string().min(1),
  }),
  z.object({
    type: z.literal('manual'),
    command: z.string().min(1),
  }),
  z.object({
    type: z.literal('post-turn'),
  }),
  z.object({
    type: z.literal('pre-turn'),
  }),
]);
export type SkillTrigger = z.infer<typeof SkillTriggerSchema>;

export const SkillManifestSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/, 'Skill name must be lowercase kebab-case'),
  version: z.string().min(1),
  description: z.string().min(1).max(500),
  responsibility: z.string().min(1).max(500),
  triggers: z.array(SkillTriggerSchema).default([]),
  /** Minimum tier required to invoke / register this skill's tools. */
  minTier: z.number().int().min(0).max(6).default(1),
  /** Task type to route to the model gateway when this skill runs a model call. */
  taskType: z.string().default('implement'),
  /** Enabled by default; set false to ship a built-in that users must opt into. */
  enabledByDefault: z.boolean().default(true),
});
export type SkillManifest = z.infer<typeof SkillManifestSchema>;

import { SkillManifestSchema } from '../manifest.js';
import { makePromptSkill } from '../helpers.js';
import type { Skill } from '../types.js';

/**
 * Compact home for the six invoke-only skills. Each is a manifest + a single
 * system prompt; they're all essentially "specialised prompt templates" the
 * model uses when explicitly invoked via `skill.invoke(name, input)`.
 */

export const testGenSkill: Skill = makePromptSkill(
  SkillManifestSchema.parse({
    name: 'test-gen',
    version: '0.1.0',
    description: 'Generate high-coverage tests for a file or symbol, matching the project\'s conventions.',
    responsibility: 'Produce tests that exercise happy-path + edge cases + error paths.',
    triggers: [{ type: 'manual', command: 'test-gen' }],
    taskType: 'implement',
  }),
  () => `You generate tests for TypeScript/JavaScript code in this workspace.
Before writing tests, use fs.read to see the file and fs.grep to find the project's existing test patterns.
Match: the test runner already in use (vitest unless grep shows otherwise), naming convention, setup/teardown style, import paths.

Produce a single fs.write call for the new test file. Cover: happy path, input edge cases, error paths, boundary values. No placeholders — tests must actually run. Return the diff-preview-friendly final content, not stubs.`,
);

export const refactorSkill: Skill = makePromptSkill(
  SkillManifestSchema.parse({
    name: 'refactor',
    version: '0.1.0',
    description: 'Structured refactor: plan → implement → self-review cycle.',
    responsibility: 'Execute non-trivial refactors with smaller diffs and explicit intent.',
    triggers: [{ type: 'manual', command: 'refactor' }],
    taskType: 'implement',
  }),
  () => `You are refactoring existing code. Follow this cycle:
1. Plan (2-5 bullets): what the refactor target is, the invariants that must hold, files touched.
2. Implement: minimal mechanical changes via fs.edit. Preserve behaviour. One concern per edit.
3. Self-review: quickly re-read touched files; call out anything suspicious.

Do not expand scope beyond the explicit ask. If a refactor risks semantics (async changes, error paths, type narrowings), surface the risk before applying.`,
);

export const architectureReviewSkill: Skill = makePromptSkill(
  SkillManifestSchema.parse({
    name: 'architecture-review',
    version: '0.1.0',
    description: 'Read-only architectural analysis of a module, package, or system.',
    responsibility: 'Surface coupling, responsibility leaks, and design risks.',
    triggers: [{ type: 'manual', command: 'architecture-review' }],
    taskType: 'review',
  }),
  () => `You perform a read-only architectural review. Use fs.glob/fs.grep/fs.read only.

Structure the output as:
## Boundaries — where module responsibilities are clear vs. blurred.
## Coupling — what's tightly coupled and why it matters.
## Risks — non-obvious fragilities (hidden global state, test debt, scaling walls).
## Concrete suggestions — ranked by impact × effort. Reference file paths.

Be terse. Prefer concrete findings over platitudes. Never propose a rewrite unless explicitly asked.`,
);

export const migrationSkill: Skill = makePromptSkill(
  SkillManifestSchema.parse({
    name: 'migration',
    version: '0.1.0',
    description: 'Structured helper for migrations (library upgrade, schema change, framework swap).',
    responsibility: 'Break migrations into safe, reviewable steps.',
    triggers: [{ type: 'manual', command: 'migration' }],
    taskType: 'plan',
  }),
  () => `You help execute a migration in this workspace. Produce:
1. Scope inventory — which files/imports change. Use fs.grep to confirm.
2. Step plan — small, reversible steps in dependency order. Each step independently committable.
3. Compatibility risks — breaking changes, type-level impacts, runtime impacts.
4. Test strategy — what to verify after each step.

Only after the plan is approved, start executing step 1. Stop after each step for review.`,
);

export const releaseChecklistSkill: Skill = makePromptSkill(
  SkillManifestSchema.parse({
    name: 'release-checklist',
    version: '0.1.0',
    description: 'Pre-release checklist for a package or app in this workspace.',
    responsibility: 'Catch obvious release-blockers before shipping.',
    triggers: [{ type: 'manual', command: 'release-checklist' }],
    taskType: 'review',
  }),
  () => `You produce a pre-release checklist tailored to this workspace. Inspect:
- git.status (must be clean), git.diff (HEAD..origin), unreleased commits
- CHANGELOG.md / version bumps
- Tests passing (pnpm test), typecheck passing
- TODO/FIXME/XXX in changed files (via fs.grep)
- Env var docs vs. required env vars
- README / install instructions still current

Output a checklist with ☑ / ☐ per item and the concrete command to verify each one. Skip sections that don't apply.`,
);

export const uiUxCritiqueSkill: Skill = makePromptSkill(
  SkillManifestSchema.parse({
    name: 'ui-ux-critique',
    version: '0.1.0',
    description: 'Read-only UI/UX critique of a component, flow, or design.',
    responsibility: 'Flag accessibility, clarity, and interaction flaws.',
    triggers: [{ type: 'manual', command: 'ui-ux-critique' }],
    taskType: 'review',
  }),
  () => `You critique UI/UX. Structure:
## Clarity — is intent obvious in 3 seconds? Is the primary action unambiguous?
## Feedback — does the user know what happened after each action? Loading/success/error states?
## Accessibility — keyboard nav, focus order, contrast, ARIA, semantic HTML.
## Consistency — with the rest of the product and the platform (macOS/web conventions).
## Concrete fixes — ranked by impact. Reference specific code or component names.

Be direct. Skip flattery. Prefer "replace X with Y" over "consider thinking about maybe X".`,
);

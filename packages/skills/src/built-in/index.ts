export { memorySummarizerSkill } from './memory-summarizer.js';
export { contextRetrievalSkill } from './context-retrieval.js';
export { docsLookupSkill } from './docs-lookup.js';
export { codeReviewSkill } from './code-review.js';
export {
  testGenSkill,
  refactorSkill,
  architectureReviewSkill,
  migrationSkill,
  releaseChecklistSkill,
  uiUxCritiqueSkill,
} from './invoke-only.js';

import { memorySummarizerSkill } from './memory-summarizer.js';
import { contextRetrievalSkill } from './context-retrieval.js';
import { docsLookupSkill } from './docs-lookup.js';
import { codeReviewSkill } from './code-review.js';
import {
  testGenSkill,
  refactorSkill,
  architectureReviewSkill,
  migrationSkill,
  releaseChecklistSkill,
  uiUxCritiqueSkill,
} from './invoke-only.js';
import type { Skill } from '../types.js';

/** All 10 built-in skills from the M4 plan, in registration order. */
export const ALL_BUILT_IN_SKILLS: readonly Skill[] = [
  memorySummarizerSkill,
  contextRetrievalSkill,
  docsLookupSkill,
  codeReviewSkill,
  testGenSkill,
  refactorSkill,
  architectureReviewSkill,
  migrationSkill,
  releaseChecklistSkill,
  uiUxCritiqueSkill,
];

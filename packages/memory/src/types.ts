import { z } from 'zod';

export const FactKindSchema = z.enum(['preference', 'convention', 'decision', 'fact']);
export type FactKind = z.infer<typeof FactKindSchema>;

export const FactInputSchema = z.object({
  kind: FactKindSchema,
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
  tags: z.array(z.string()).optional().default([]),
  confidence: z.number().min(0).max(1).optional().default(1.0),
  source: z.string().optional().default('manual'),
});
// `z.input` preserves the optionality of .optional().default() fields so callers
// don't have to supply confidence/source/tags — they get the schema's defaults.
export type FactInput = z.input<typeof FactInputSchema>;

export interface Fact {
  id: string;
  kind: FactKind;
  title: string;
  body: string;
  tags: string[];
  path: string | null;
  source: string;
  confidence: number;
  createdAt: number;
  updatedAt: number;
  projectRoot: string;
}

export interface AlwaysLoadedMemory {
  claudeMd: string | null;
  preferences: string | null;
  conventions: string | null;
  architecture: string | null;
}

export interface SessionRecord {
  id: string;
  projectRoot: string;
  startedAt: number;
  endedAt: number | null;
  summary: string | null;
  tier: number;
}

export interface TurnRecord {
  id: string;
  sessionId: string;
  userMessage: string;
  assistantMessage: string | null;
  toolCallsJson: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  model: string | null;
  taskType: string | null;
  startedAt: number;
  endedAt: number | null;
  error: string | null;
}

/** One line in `.agent/CHANGELOG.md`. Kept tiny so the tail fits in-prompt. */
export interface ActivityEntry {
  timestamp: number;
  sessionId: string;
  /** Short verb bucket: edit, feat, fix, chore, refactor, test, docs, conf, commit, push, run, change */
  kind: string;
  /** One-line human summary, max 100 chars. */
  summary: string;
  /** Up to 5 file paths most affected. */
  files: string[];
}

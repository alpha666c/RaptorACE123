import { z } from 'zod';

export const ModelConfigSchema = z.object({
  models: z.record(z.string(), z.string()),
  routing: z.record(z.string(), z.string()),
  fallbacks: z.record(z.string(), z.array(z.string())).optional().default({}),
  limits: z
    .object({
      maxOutputTokens: z.number().int().min(1).optional(),
      temperature: z.number().min(0).max(2).optional(),
    })
    .optional()
    .default({}),
  costGuardrail: z
    .object({
      maxPerTurnUSD: z.number().nonnegative().optional(),
      downshiftOnExceed: z.boolean().optional(),
    })
    .optional()
    .default({}),
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

export type TaskType = string; // e.g. "plan" | "implement" | "review" | "summarize" | "council.architect"

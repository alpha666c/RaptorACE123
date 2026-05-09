/**
 * Per-model pricing ($ per 1M tokens). Values are **approximate and drift over
 * time** — OpenRouter publishes live pricing via its `/api/v1/models` endpoint
 * which we could auto-ingest in a later milestone. For M3 we ship a static
 * table covering the models used in the default router. Unknown models return
 * zero cost rather than failing.
 *
 * Last manually verified: 2026-05-08 from OpenRouter's published pricing.
 */
export interface ModelPricing {
  /** USD per 1M input tokens. */
  inputPerMillion: number;
  /** USD per 1M output tokens. */
  outputPerMillion: number;
}

const PRICING: Record<string, ModelPricing> = {
  // Anthropic
  'anthropic/claude-opus-4.7': { inputPerMillion: 15.0, outputPerMillion: 75.0 },
  'anthropic/claude-opus-4.6-fast': { inputPerMillion: 5.0, outputPerMillion: 25.0 },
  'anthropic/claude-sonnet-4.6': { inputPerMillion: 3.0, outputPerMillion: 15.0 },

  // OpenAI
  'openai/gpt-5.5-pro': { inputPerMillion: 30.0, outputPerMillion: 180.0 },
  'openai/gpt-5.5': { inputPerMillion: 5.0, outputPerMillion: 30.0 },
  'openai/gpt-5.4-pro': { inputPerMillion: 30.0, outputPerMillion: 180.0 },
  'openai/gpt-5.4': { inputPerMillion: 2.5, outputPerMillion: 15.0 },
  'openai/gpt-5.4-mini': { inputPerMillion: 0.75, outputPerMillion: 4.5 },
  'openai/gpt-5.4-nano': { inputPerMillion: 0.2, outputPerMillion: 1.25 },
  'openai/gpt-5.3-codex': { inputPerMillion: 1.75, outputPerMillion: 14.0 },
  'openai/gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10.0 },
  'openai/gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },

  // Google
  'google/gemini-3.1-pro-preview': { inputPerMillion: 2.0, outputPerMillion: 12.0 },
  'google/gemini-3.1-flash-lite': { inputPerMillion: 0.25, outputPerMillion: 1.5 },
  'google/gemini-2.5-pro': { inputPerMillion: 1.25, outputPerMillion: 10.0 },

  // DeepSeek — best bang-for-buck coding models as of May 2026
  'deepseek/deepseek-v4-pro': { inputPerMillion: 0.435, outputPerMillion: 0.87 },
  'deepseek/deepseek-v4-flash': { inputPerMillion: 0.14, outputPerMillion: 0.28 },

  // xAI Grok — long-context budget option
  'x-ai/grok-4.20': { inputPerMillion: 1.25, outputPerMillion: 2.5 },
  'x-ai/grok-4.3': { inputPerMillion: 1.25, outputPerMillion: 2.5 },
};

export function estimateCostUsd(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = PRICING[modelId];
  if (!p) return 0;
  const input = (inputTokens / 1_000_000) * p.inputPerMillion;
  const output = (outputTokens / 1_000_000) * p.outputPerMillion;
  return Number((input + output).toFixed(6));
}

export function pricingFor(modelId: string): ModelPricing | undefined {
  return PRICING[modelId];
}

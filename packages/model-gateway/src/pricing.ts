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
  'anthropic/claude-opus-4.7': { inputPerMillion: 15.0, outputPerMillion: 75.0 },
  'anthropic/claude-opus-4.6-fast': { inputPerMillion: 5.0, outputPerMillion: 25.0 },
  'anthropic/claude-sonnet-4.6': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  'openai/gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10.0 },
  'openai/gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  'google/gemini-2.5-pro': { inputPerMillion: 1.25, outputPerMillion: 10.0 },
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

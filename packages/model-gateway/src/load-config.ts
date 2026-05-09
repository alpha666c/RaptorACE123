import * as fs from 'node:fs/promises';
import { ModelConfigSchema, type ModelConfig } from './config-schema.js';

export async function loadModelConfig(path: string): Promise<ModelConfig> {
  const raw = await fs.readFile(path, 'utf8');
  const json = JSON.parse(raw) as unknown;
  return ModelConfigSchema.parse(json);
}

/**
 * Default alias menu — sorted roughly cheap → expensive so the webview's
 * dropdown reads top-to-bottom by cost. Verified against OpenRouter's live
 * catalog on 2026-05-10.
 */
export const DEFAULT_MODEL_CONFIG: ModelConfig = ModelConfigSchema.parse({
  models: {
    'cheap-deepseek-flash': 'deepseek/deepseek-v4-flash',
    'cheap-gpt-nano': 'openai/gpt-5.4-nano',
    'cheap-gemini-flash': 'google/gemini-3.1-flash-lite',
    'budget-deepseek-pro': 'deepseek/deepseek-v4-pro',
    'budget-gpt-mini': 'openai/gpt-5.4-mini',
    'budget-grok-standard': 'x-ai/grok-4.3',
    'budget-grok-long': 'x-ai/grok-4.20',
    'coding-gpt-codex': 'openai/gpt-5.3-codex',
    'coding-gemini-pro': 'google/gemini-3.1-pro-preview',
    'coding-gpt-standard': 'openai/gpt-5.4',
    'balanced-coding': 'anthropic/claude-sonnet-4.6',
    'coding-opus-fast': 'anthropic/claude-opus-4.6-fast',
    'high-reasoning-coding': 'anthropic/claude-opus-4.7',
    'reasoning-gpt-5-5': 'openai/gpt-5.5',
    'reasoning-gpt-5-4-pro': 'openai/gpt-5.4-pro',
    'reasoning-gpt-5-5-pro': 'openai/gpt-5.5-pro',
    'fast-cheap': 'deepseek/deepseek-v4-flash',
  },
  routing: {
    default: 'balanced-coding',
    plan: 'high-reasoning-coding',
    implement: 'balanced-coding',
    review: 'high-reasoning-coding',
    summarize: 'fast-cheap',
  },
  fallbacks: {
    'high-reasoning-coding': ['balanced-coding', 'coding-gpt-standard'],
    'balanced-coding': ['coding-gpt-standard', 'budget-deepseek-pro'],
  },
  limits: { maxOutputTokens: 8192, temperature: 0.2 },
});

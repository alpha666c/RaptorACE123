import * as fs from 'node:fs/promises';
import { ModelConfigSchema, type ModelConfig } from './config-schema.js';

export async function loadModelConfig(path: string): Promise<ModelConfig> {
  const raw = await fs.readFile(path, 'utf8');
  const json = JSON.parse(raw) as unknown;
  return ModelConfigSchema.parse(json);
}

export const DEFAULT_MODEL_CONFIG: ModelConfig = ModelConfigSchema.parse({
  models: {
    'high-reasoning-coding': 'anthropic/claude-opus-4.7',
    'balanced-coding': 'anthropic/claude-sonnet-4.6',
    'fast-cheap': 'anthropic/claude-opus-4.6-fast',
  },
  routing: {
    default: 'balanced-coding',
    plan: 'high-reasoning-coding',
    implement: 'balanced-coding',
    review: 'high-reasoning-coding',
    summarize: 'fast-cheap',
  },
  fallbacks: {
    'high-reasoning-coding': ['balanced-coding'],
    'balanced-coding': ['fast-cheap'],
  },
  limits: { maxOutputTokens: 8192, temperature: 0.2 },
});

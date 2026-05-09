import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModel } from 'ai';
import { getLogger } from '@agent/shared';
import type { ModelConfig, TaskType } from './config-schema.js';

export interface GatewayOptions {
  apiKey: string;
  config: ModelConfig;
  /** Optional override for the OpenRouter base URL (e.g. for a local proxy). */
  baseURL?: string;
}

export interface ModelSelection {
  taskType: TaskType;
  alias: string;
  resolvedModel: string;
  model: LanguageModel;
  limits: ModelConfig['limits'];
  fallbacks: string[];
}

export class ModelGateway {
  private openrouter: ReturnType<typeof createOpenRouter>;
  private log = getLogger('model-gateway');

  constructor(private opts: GatewayOptions) {
    this.openrouter = createOpenRouter({
      apiKey: opts.apiKey,
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    });
  }

  /**
   * Resolve a task type → alias → concrete model id, and return an AI SDK LanguageModel.
   * Falls back to `default` alias if the task type is unmapped.
   */
  selectModel(taskType: TaskType): ModelSelection {
    const cfg = this.opts.config;
    const alias = cfg.routing[taskType] ?? cfg.routing['default'];
    if (!alias) {
      throw new Error(`No routing entry for task type "${taskType}" and no "default" alias configured.`);
    }
    const resolved = cfg.models[alias];
    if (!resolved) {
      throw new Error(`Alias "${alias}" not in models map.`);
    }
    const fallbackAliases = cfg.fallbacks[alias] ?? [];
    const fallbacks = fallbackAliases
      .map((a) => cfg.models[a])
      .filter((x): x is string => Boolean(x));

    this.log.debug({ taskType, alias, resolved }, 'model-gateway.select');
    return {
      taskType,
      alias,
      resolvedModel: resolved,
      model: this.openrouter.chat(resolved),
      limits: cfg.limits,
      fallbacks,
    };
  }

  /** List available aliases for UI menus. */
  listAliases(): Array<{ alias: string; modelId: string }> {
    return Object.entries(this.opts.config.models).map(([alias, modelId]) => ({ alias, modelId }));
  }

  /**
   * Resolve a specific model id directly, bypassing the task-type → alias
   * routing. Used when the UI's model picker forces a model for the next turn.
   */
  selectByModelId(modelId: string): ModelSelection {
    return {
      taskType: 'override',
      alias: 'override',
      resolvedModel: modelId,
      model: this.openrouter.chat(modelId),
      limits: this.opts.config.limits,
      fallbacks: [],
    };
  }
}

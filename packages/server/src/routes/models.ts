import { Hono } from 'hono';
import { pricingFor } from '@agent/model-gateway';
import type { ServerState } from '../types.js';

export function modelsRouter(state: ServerState): Hono {
  const app = new Hono();

  app.get('/', (c) => {
    const aliases = state.gateway.listAliases().map(({ alias, modelId }) => {
      const pricing = pricingFor(modelId);
      return {
        alias,
        modelId,
        pricing: pricing ?? null,
      };
    });
    return c.json({ aliases });
  });

  return app;
}

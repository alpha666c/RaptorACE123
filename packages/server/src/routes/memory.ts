import { Hono } from 'hono';
import { z } from 'zod';
import { assertNoSecrets, SecretScanError } from '@agent/skills';
import { FactInputSchema } from '@agent/memory';
import type { ServerState } from '../types.js';

export function memoryRouter(state: ServerState): Hono {
  const app = new Hono();

  app.get('/facts', (c) => {
    const query = c.req.query('query');
    const limit = Number(c.req.query('limit') ?? 50);
    const facts = query
      ? state.memory.searchFacts(query, Math.min(limit, 100))
      : state.memory.listFacts(Math.min(limit, 100));
    return c.json({ facts });
  });

  app.post('/facts', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid json' }, 400);
    }
    const parsed = FactInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid fact', details: parsed.error.format() }, 400);
    }
    try {
      assertNoSecrets(parsed.data.title, parsed.data.body, (parsed.data.tags ?? []).join(' '));
    } catch (e) {
      if (e instanceof SecretScanError) {
        return c.json(
          {
            error: 'secret-detected',
            findings: e.findings.map((f) => f.detector),
            message: 'Refusing to save: the content appears to contain a secret.',
          },
          422,
        );
      }
      throw e;
    }
    const fact = state.memory.writeFact(parsed.data);
    return c.json({ fact }, 201);
  });

  app.get('/always-loaded', (c) => {
    return c.json(state.memory.loadAlwaysLoaded());
  });

  const SetTierSchema = z.object({ tier: z.number().int().min(0).max(6) });
  app.post('/tier', async (c) => {
    const body = (await c.req.json().catch(() => null)) as unknown;
    const parsed = SetTierSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'bad tier' }, 400);
    state.session.setTier(parsed.data.tier as 0 | 1 | 2 | 3 | 4 | 5 | 6);
    return c.json({ ok: true, tier: state.session.getTier() });
  });

  return app;
}

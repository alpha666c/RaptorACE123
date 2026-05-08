import { Hono } from 'hono';
import { z } from 'zod';
import type { ServerState } from '../types.js';

export function permissionsRouter(state: ServerState): Hono {
  const app = new Hono();

  app.get('/', (c) => {
    return c.json({
      currentTier: state.session.getTier(),
      readOnlyKillSwitch: process.env['AGENT_READ_ONLY'] === '1',
      pendingApprovals: [...state.pendingApprovals.keys()],
    });
  });

  const TierSchema = z.object({ tier: z.number().int().min(0).max(6) });
  app.post('/tier', async (c) => {
    const body = (await c.req.json().catch(() => null)) as unknown;
    const parsed = TierSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'bad tier' }, 400);
    state.session.setTier(parsed.data.tier as 0 | 1 | 2 | 3 | 4 | 5 | 6);
    return c.json({ ok: true, tier: state.session.getTier() });
  });

  const DecideSchema = z.object({
    requestId: z.string().min(1),
    action: z.enum(['allow-once', 'allow-session', 'deny']),
  });
  app.post('/decide', async (c) => {
    const body = (await c.req.json().catch(() => null)) as unknown;
    const parsed = DecideSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'bad body' }, 400);
    const resolver = state.pendingApprovals.get(parsed.data.requestId);
    if (!resolver) return c.json({ error: 'no such pending request' }, 404);
    resolver({ action: parsed.data.action });
    state.pendingApprovals.delete(parsed.data.requestId);
    return c.json({ ok: true });
  });

  return app;
}

import { Hono } from 'hono';
import { z } from 'zod';
import type { ServerState } from '../types.js';

export function skillsRouter(state: ServerState): Hono {
  const app = new Hono();

  app.get('/', (c) => {
    const skills = state.skills.list().map((s) => ({
      name: s.manifest.name,
      description: s.manifest.description,
      version: s.manifest.version,
      triggers: s.manifest.triggers.map((t) => t.type),
      enabled: state.skills.isEnabled(s.manifest.name),
      minTier: s.manifest.minTier,
      invocable: typeof s.invoke === 'function',
    }));
    return c.json({ skills });
  });

  const ToggleSchema = z.object({ enabled: z.boolean() });
  app.post('/:name/enabled', async (c) => {
    const name = c.req.param('name');
    const body = (await c.req.json().catch(() => null)) as unknown;
    const parsed = ToggleSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'bad body' }, 400);
    if (!state.skills.get(name)) return c.json({ error: 'not found' }, 404);
    state.skills.setEnabled(name, parsed.data.enabled);
    return c.json({ ok: true, enabled: state.skills.isEnabled(name) });
  });

  return app;
}

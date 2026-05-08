import { Hono } from 'hono';
import type { ServerState } from '../types.js';

export function sessionsRouter(state: ServerState): Hono {
  const app = new Hono();

  app.get('/', (c) => {
    const limit = Number(c.req.query('limit') ?? 20);
    const sessions = state.memory.listSessions(Number.isFinite(limit) ? limit : 20);
    return c.json({ sessions });
  });

  return app;
}

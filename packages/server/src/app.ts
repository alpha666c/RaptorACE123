import { Hono } from 'hono';
import { bearerAuth } from './auth.js';
import { sessionsRouter } from './routes/sessions.js';
import { memoryRouter } from './routes/memory.js';
import { skillsRouter } from './routes/skills.js';
import { mcpRouter } from './routes/mcp.js';
import { modelsRouter } from './routes/models.js';
import { permissionsRouter } from './routes/permissions.js';
import { eventsRouter } from './routes/events.js';
import { chatRouter } from './routes/chat.js';
import type { ServerState } from './types.js';

export interface AppOptions {
  /** Enables POST /api/chat. Used by the standalone runtime; extension omits this. */
  runTurn?: (message: string, signal: AbortSignal) => Promise<{ text: string }>;
}

export function buildApp(state: ServerState, options: AppOptions = {}): Hono {
  const app = new Hono();

  // Health is unauthenticated — useful for the web app to verify the server is up.
  app.get('/api/health', (c) => c.json({ ok: true, version: '0.1.0' }));

  // CORS: allow localhost origins only. The server binds to 127.0.0.1 so this
  // is mostly belt-and-suspenders, but it's the right default for the web app.
  app.use('/api/*', async (c, next) => {
    const origin = c.req.header('origin') ?? '';
    if (
      /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin) ||
      origin === ''
    ) {
      c.res.headers.set('access-control-allow-origin', origin || '*');
      c.res.headers.set('access-control-allow-headers', 'authorization, content-type');
      c.res.headers.set('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
    }
    if (c.req.method === 'OPTIONS') return c.body(null, 204);
    await next();
  });

  // Every /api/* route except /health requires the bearer token.
  app.use('/api/*', async (c, next) => {
    if (c.req.path === '/api/health') return next();
    return bearerAuth(state.token)(c, next);
  });

  app.route('/api/sessions', sessionsRouter(state));
  app.route('/api/memory', memoryRouter(state));
  app.route('/api/skills', skillsRouter(state));
  app.route('/api/mcp', mcpRouter(state));
  app.route('/api/models', modelsRouter(state));
  app.route('/api/permissions', permissionsRouter(state));
  app.route('/api/events', eventsRouter(state));
  if (options.runTurn) {
    app.route('/api/chat', chatRouter(state, options.runTurn));
  }

  app.notFound((c) => c.json({ error: 'not found', path: c.req.path }, 404));

  return app;
}

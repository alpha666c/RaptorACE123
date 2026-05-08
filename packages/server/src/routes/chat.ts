import { Hono } from 'hono';
import { z } from 'zod';
import type { ServerState } from '../types.js';

/**
 * The chat route is populated by the runtime (extension or standalone) by
 * passing in a `runTurn` implementation that drives the AgentHost. The server
 * package stays agnostic to how the AgentHost is wired — this is just the
 * HTTP surface.
 *
 * POST /api/chat — body: `{ message: string }`. Returns a streamed response
 * with plain-text chunks. For simplicity (and to match the web UI's fetch
 * expectations), this is a plain POST that returns a single JSON body when
 * done; a future improvement wraps it in SSE so the web UI streams chunks.
 */
export function chatRouter(
  _state: ServerState,
  runTurn: (message: string, signal: AbortSignal) => Promise<{ text: string }>,
): Hono {
  const app = new Hono();

  const BodySchema = z.object({ message: z.string().min(1).max(20_000) });

  app.post('/', async (c) => {
    const body = (await c.req.json().catch(() => null)) as unknown;
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'bad body' }, 400);
    const controller = new AbortController();
    c.req.raw.signal.addEventListener('abort', () => controller.abort());
    try {
      const result = await runTurn(parsed.data.message, controller.signal);
      return c.json({ text: result.text });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500);
    }
  });

  return app;
}

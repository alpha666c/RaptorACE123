import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AgentEvent } from '@agent/shared';
import type { ServerState } from '../types.js';

/**
 * SSE stream of agent events. Clients connect with `Accept: text/event-stream`
 * and receive JSON-encoded `AgentEvent` payloads as they happen. The server
 * rebroadcasts every event emitted by the live agent.
 */
export function eventsRouter(state: ServerState): Hono {
  const app = new Hono();

  app.get('/', (c) => {
    return streamSSE(c, async (stream) => {
      const queue: AgentEvent[] = [];
      let resolveWake: (() => void) | null = null;

      const unsubscribe = state.subscribeEvents((ev) => {
        queue.push(ev);
        resolveWake?.();
      });

      // Send an initial hello so the client knows the stream is live even
      // before any agent activity.
      await stream.writeSSE({
        event: 'hello',
        data: JSON.stringify({ timestamp: Date.now() }),
      });

      stream.onAbort(() => {
        unsubscribe();
        resolveWake?.();
      });

      try {
        while (!stream.aborted) {
          if (queue.length === 0) {
            await new Promise<void>((resolve) => {
              resolveWake = resolve;
            });
            resolveWake = null;
            continue;
          }
          const ev = queue.shift();
          if (!ev) continue;
          await stream.writeSSE({ event: ev.kind, data: JSON.stringify(ev) });
        }
      } finally {
        unsubscribe();
      }
    });
  });

  return app;
}

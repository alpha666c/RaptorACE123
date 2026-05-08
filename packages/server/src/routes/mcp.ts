import { Hono } from 'hono';
import type { ServerState } from '../types.js';

export function mcpRouter(state: ServerState): Hono {
  const app = new Hono();

  app.get('/servers', (c) => {
    const grouped = new Map<string, { name: string; tools: Array<{ name: string; description: string }> }>();
    for (const { server, tool } of state.mcp.allTools()) {
      const entry = grouped.get(server.name) ?? { name: server.name, tools: [] };
      entry.tools.push({ name: tool.name, description: tool.description });
      grouped.set(server.name, entry);
    }
    return c.json({ servers: [...grouped.values()] });
  });

  return app;
}

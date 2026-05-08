import { randomBytes } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';

/** Generate a URL-safe 32-byte token (64 hex chars). */
export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Require a bearer token on every request.
 * Allows the token via:
 *   - `Authorization: Bearer <token>` header (preferred)
 *   - `?token=<token>` query param (for SSE, which can't always send headers)
 */
export function bearerAuth(expectedToken: string): MiddlewareHandler {
  return async (c: Context, next) => {
    const header = c.req.header('authorization') ?? '';
    let provided: string | null = null;
    if (header.startsWith('Bearer ')) provided = header.slice('Bearer '.length).trim();
    if (!provided) provided = c.req.query('token') ?? null;
    if (!provided || !constantTimeEqual(provided, expectedToken)) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
    return;
  };
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

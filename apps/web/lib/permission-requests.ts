'use client';
import { useEffect, useState } from 'react';
import { getServerUrl, getToken } from './api.js';

export interface PendingPermission {
  requestId: string;
  tool: string;
  args: unknown;
  requiredTier: number;
  currentTier: number;
  reason: string;
  timestamp: number;
}

/**
 * Subscribe to `permission.request` SSE events and maintain a queue of
 * pending approvals. Call `dismiss(requestId)` when the user has decided —
 * the server-side pending-approvals map gets cleared by the POST /decide,
 * this hook just removes it from local state.
 */
export function usePermissionRequests(): {
  pending: PendingPermission[];
  dismiss: (requestId: string) => void;
} {
  const [pending, setPending] = useState<PendingPermission[]>([]);

  useEffect(() => {
    const url = `${getServerUrl()}/api/events?token=${encodeURIComponent(getToken())}`;
    const src = new EventSource(url);
    const handler = (ev: MessageEvent) => {
      try {
        const parsed = JSON.parse(ev.data) as {
          kind?: string;
          requestId?: string;
          tool?: string;
          args?: unknown;
          requiredTier?: number;
          currentTier?: number;
          reason?: string;
        };
        if (
          parsed.kind === 'permission.request' &&
          typeof parsed.requestId === 'string' &&
          typeof parsed.tool === 'string'
        ) {
          setPending((prev) => {
            if (prev.some((p) => p.requestId === parsed.requestId)) return prev;
            return [
              ...prev,
              {
                requestId: parsed.requestId!,
                tool: parsed.tool!,
                args: parsed.args,
                requiredTier: parsed.requiredTier ?? 0,
                currentTier: parsed.currentTier ?? 0,
                reason: parsed.reason ?? '',
                timestamp: Date.now(),
              },
            ];
          });
        }
      } catch {
        // Ignore malformed events.
      }
    };
    src.addEventListener('permission.request', handler);
    src.onerror = () => {
      // EventSource auto-reconnects; nothing to do.
    };
    return () => src.close();
  }, []);

  const dismiss = (requestId: string) => {
    setPending((prev) => prev.filter((p) => p.requestId !== requestId));
  };

  return { pending, dismiss };
}

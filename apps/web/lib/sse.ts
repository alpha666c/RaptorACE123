'use client';
import { useEffect, useState } from 'react';
import { getServerUrl, getToken } from './api.js';

export interface LiveEvent {
  kind: string;
  [key: string]: unknown;
}

/**
 * Subscribe to the agent server's SSE stream. Buffers the last N events in
 * state for display in a live log panel.
 */
export function useAgentEvents(bufferSize = 50): LiveEvent[] {
  const [events, setEvents] = useState<LiveEvent[]>([]);

  useEffect(() => {
    const url = `${getServerUrl()}/api/events?token=${encodeURIComponent(getToken())}`;
    const src = new EventSource(url);
    src.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as LiveEvent;
        setEvents((prev) => [...prev, parsed].slice(-bufferSize));
      } catch {
        // Ignore malformed payloads.
      }
    };
    // Also listen for named events (Hono emits them by event kind).
    const kinds = [
      'hello',
      'agent.started',
      'agent.stopped',
      'message.chunk',
      'message.complete',
      'tool.call',
      'tool.result',
      'tool.error',
      'permission.request',
      'model.call',
      'error',
    ];
    for (const kind of kinds) {
      src.addEventListener(kind, (ev) => {
        try {
          const parsed = JSON.parse((ev as MessageEvent).data) as LiveEvent;
          setEvents((prev) => [...prev, parsed].slice(-bufferSize));
        } catch {
          // Ignore.
        }
      });
    }
    src.onerror = () => {
      // EventSource auto-reconnects; nothing to do here.
    };
    return () => src.close();
  }, [bufferSize]);

  return events;
}

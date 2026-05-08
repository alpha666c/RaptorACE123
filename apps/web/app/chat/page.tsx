'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useAgentEvents, type LiveEvent } from '@/lib/sse';

interface Message {
  role: 'user' | 'assistant' | 'event';
  text: string;
  timestamp: number;
}

/**
 * Chat page. Sends messages to POST /api/chat (only exposed by the standalone
 * agent runtime, not the VS Code extension). Live tool calls + events stream
 * in from /api/events via SSE and are interleaved with the user/assistant
 * messages so the user can see what the agent is doing during a turn.
 */
export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const events = useAgentEvents(100);
  const lastEventIdx = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);

  // When we're busy and new events arrive, fold them into the message stream
  // as lightweight "event" bubbles. Skip events that are just `hello` / tier
  // changes — they add noise.
  useEffect(() => {
    if (!busy) return;
    while (lastEventIdx.current < events.length) {
      const ev = events[lastEventIdx.current++];
      if (!ev) continue;
      const formatted = formatEvent(ev);
      if (formatted) {
        setMessages((prev) => [...prev, { role: 'event', text: formatted, timestamp: Date.now() }]);
      }
    }
  }, [events, busy]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  async function send() {
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text: trimmed, timestamp: Date.now() }]);
    lastEventIdx.current = events.length;
    setBusy(true);
    setError(null);
    try {
      const res = await api.chat(trimmed);
      setMessages((prev) => [...prev, { role: 'assistant', text: res.text, timestamp: Date.now() }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-3rem)]">
      <header className="pb-4 border-b border-white/10">
        <h1 className="text-xl font-semibold">Chat</h1>
        <p className="text-sm text-white/60 mt-1">
          Talk to the agent. Tool calls stream live. Requires the standalone runtime (not the VS Code extension);
          in VS Code, use the chat panel there.
        </p>
      </header>

      <div ref={logRef} className="flex-1 overflow-auto py-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-sm text-white/40 text-center py-10">
            Nothing yet. Ask the agent something.
          </div>
        )}
        {messages.map((m, i) => (
          <MessageBubble key={i} message={m} />
        ))}
        {busy && (
          <div className="text-xs text-white/50 italic px-2">agent is working…</div>
        )}
      </div>

      {error && (
        <div className="border border-red-500/40 text-red-300 rounded p-2 text-sm mb-2">
          {error}
        </div>
      )}

      <div className="border-t border-white/10 pt-3 flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Ask the agent… (⌘+Enter to send)"
          rows={3}
          className="flex-1 border border-white/10 rounded px-3 py-2 bg-white/5 text-sm resize-none focus:outline-none focus:border-white/30"
          disabled={busy}
        />
        <button
          onClick={send}
          disabled={busy || !input.trim()}
          className="px-4 py-2 rounded bg-white text-black text-sm font-medium hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-white/10 rounded-lg px-4 py-2 text-sm whitespace-pre-wrap">
          {message.text}
        </div>
      </div>
    );
  }
  if (message.role === 'assistant') {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] border border-white/10 rounded-lg px-4 py-2 text-sm whitespace-pre-wrap leading-relaxed">
          {message.text}
        </div>
      </div>
    );
  }
  // event
  return (
    <div className="text-xs text-white/40 mono px-2 border-l-2 border-white/10">
      {message.text}
    </div>
  );
}

function formatEvent(ev: LiveEvent): string | null {
  switch (ev.kind) {
    case 'tool.call':
      return `→ ${String(ev['name'] ?? '?')}`;
    case 'tool.result':
      return `✓ ${String(ev['name'] ?? '?')} (${String(ev['durationMs'] ?? '?')}ms)`;
    case 'tool.error':
      return `✗ ${String(ev['name'] ?? '?')}: ${String(ev['error'] ?? '')}`;
    case 'model.call':
      return `· ${String(ev['model'] ?? '?')} — in ${String(ev['inputTokens'] ?? '?')} / out ${String(ev['outputTokens'] ?? '?')} tok, $${Number(ev['costUsd'] ?? 0).toFixed(4)}`;
    case 'error':
      return `⚠ ${String(ev['message'] ?? 'error')}`;
    default:
      return null; // skip hello, agent.started/stopped, message.chunk (we get the full text from /api/chat)
  }
}

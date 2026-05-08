'use client';
import { useEffect, useState } from 'react';
import { api, type SessionRecord } from '@/lib/api';
import { useAgentEvents } from '@/lib/sse';

export default function DashboardPage() {
  const [health, setHealth] = useState<'checking' | 'ok' | 'error' | 'unauthorized'>('checking');
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [tier, setTier] = useState<number | null>(null);
  const events = useAgentEvents(30);

  useEffect(() => {
    api
      .health()
      .then(() => setHealth('ok'))
      .catch((e: { status?: number }) => setHealth(e.status === 401 ? 'unauthorized' : 'error'));
    api.sessions(10).then((r) => setSessions(r.sessions)).catch(() => {});
    api.permissions().then((r) => setTier(r.currentTier)).catch(() => {});
  }, []);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-white/60 mt-1">Live view of the agent running in VS Code.</p>
      </header>

      <section className="grid grid-cols-3 gap-4">
        <Card label="Server">
          <span
            className={`inline-block w-2 h-2 rounded-full mr-2 ${
              health === 'ok' ? 'bg-emerald-500' : health === 'checking' ? 'bg-yellow-500' : 'bg-red-500'
            }`}
          />
          <span>
            {health === 'ok'
              ? 'Connected'
              : health === 'checking'
                ? 'Checking…'
                : health === 'unauthorized'
                  ? 'Unauthorized — set token in Settings'
                  : 'Offline — open the agent in VS Code'}
          </span>
        </Card>
        <Card label="Permission tier">
          {tier !== null ? `T${tier}` : '—'}
        </Card>
        <Card label="Recent sessions">
          {sessions.length}
        </Card>
      </section>

      <section>
        <h2 className="text-sm font-medium text-white/80 mb-2">Live events</h2>
        <div className="border border-white/10 rounded p-3 font-mono text-xs max-h-80 overflow-auto space-y-1">
          {events.length === 0 ? (
            <div className="text-white/40">Waiting for agent activity…</div>
          ) : (
            events.map((ev, i) => (
              <div key={i} className="whitespace-pre-wrap break-all">
                <span className="text-white/40">[{ev.kind}]</span> {JSON.stringify(ev)}
              </div>
            ))
          )}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-white/80 mb-2">Recent sessions</h2>
        <div className="space-y-2">
          {sessions.map((s) => (
            <div key={s.id} className="border border-white/10 rounded p-3 flex items-center justify-between text-sm">
              <div>
                <div className="mono text-white/80">{s.id}</div>
                <div className="text-white/50 text-xs">
                  {new Date(s.startedAt).toLocaleString()} · tier T{s.tier}
                </div>
              </div>
              <div className="text-white/60 text-xs">{s.summary ?? '—'}</div>
            </div>
          ))}
          {sessions.length === 0 && <div className="text-sm text-white/50">No sessions yet.</div>}
        </div>
      </section>
    </div>
  );
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border border-white/10 rounded p-4">
      <div className="text-xs text-white/50 mb-1">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

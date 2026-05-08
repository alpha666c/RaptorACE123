'use client';
import { useEffect, useState } from 'react';
import { api, type SessionRecord } from '@/lib/api';

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.sessions(100).then((r) => setSessions(r.sessions)).catch((e) => setError((e as Error).message));
  }, []);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Sessions</h1>
        <p className="text-sm text-white/60 mt-1">History of agent sessions in this workspace.</p>
      </header>

      {error && <div className="border border-red-500/40 text-red-300 rounded p-3 text-sm">{error}</div>}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-white/50 text-xs">
            <th className="py-2">ID</th>
            <th className="py-2">Started</th>
            <th className="py-2">Tier</th>
            <th className="py-2">Summary</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id} className="border-t border-white/10">
              <td className="py-2 mono text-xs">{s.id.slice(0, 16)}…</td>
              <td className="py-2 text-white/70">{new Date(s.startedAt).toLocaleString()}</td>
              <td className="py-2">T{s.tier}</td>
              <td className="py-2 text-white/60">{s.summary ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sessions.length === 0 && !error && <div className="text-sm text-white/50">No sessions yet.</div>}
    </div>
  );
}

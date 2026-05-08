'use client';
import { useEffect, useState } from 'react';
import { api, type McpServerSummary } from '@/lib/api';

export default function McpPage() {
  const [servers, setServers] = useState<McpServerSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.mcpServers().then((r) => setServers(r.servers)).catch((e) => setError((e as Error).message));
  }, []);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">MCP servers</h1>
        <p className="text-sm text-white/60 mt-1">Live servers spawned by the agent's supervisor.</p>
      </header>

      {error && <div className="border border-red-500/40 text-red-300 rounded p-3 text-sm">{error}</div>}

      <div className="space-y-3">
        {servers.map((s) => (
          <div key={s.name} className="border border-white/10 rounded p-4">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">{s.name}</span>
              <span className="text-xs text-white/50">{s.tools.length} tool{s.tools.length === 1 ? '' : 's'}</span>
            </div>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-1">
              {s.tools.map((t) => (
                <div key={t.name} className="text-xs border border-white/10 rounded px-2 py-1">
                  <div className="mono">{t.name}</div>
                  <div className="text-white/50 truncate">{t.description}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {servers.length === 0 && !error && <div className="text-sm text-white/50">No MCP servers running.</div>}
      </div>
    </div>
  );
}

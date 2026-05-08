'use client';
import { useEffect, useState } from 'react';
import { api, type Fact } from '@/lib/api';

export default function MemoryPage() {
  const [facts, setFacts] = useState<Fact[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load(q: string) {
    try {
      const res = await api.facts({ query: q || undefined, limit: 100 });
      setFacts(res.facts);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    load('');
  }, []);

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Memory</h1>
          <p className="text-sm text-white/60 mt-1">
            Facts auto-saved by the memory-summarizer skill + any you add manually.
          </p>
        </div>
        <input
          placeholder="Search facts…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') load(query);
          }}
          className="border border-white/10 rounded px-3 py-1.5 bg-white/5 text-sm w-64"
        />
      </header>

      {error && <div className="border border-red-500/40 text-red-300 rounded p-3 text-sm">{error}</div>}

      <div className="space-y-3">
        {facts.map((f) => (
          <div key={f.id} className="border border-white/10 rounded p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-0.5 rounded bg-white/10">{f.kind}</span>
                  <span className="font-medium text-sm">{f.title}</span>
                </div>
                <p className="text-sm text-white/70 mt-2 whitespace-pre-wrap">{f.body}</p>
                <div className="flex items-center gap-2 mt-3 text-xs text-white/40">
                  {f.tags.map((t) => (
                    <span key={t} className="px-1.5 py-0.5 rounded bg-white/5">
                      #{t}
                    </span>
                  ))}
                  <span>· {new Date(f.updatedAt).toLocaleString()}</span>
                  <span>· {f.source}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
        {facts.length === 0 && !error && (
          <div className="text-sm text-white/50">
            No facts yet. The memory-summarizer will auto-save durable facts from conversations; you can also add them via
            <code className="mono text-xs"> Personal Agent: Save Memory Fact</code> in VS Code.
          </div>
        )}
      </div>
    </div>
  );
}

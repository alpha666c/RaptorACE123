'use client';
import { useEffect, useState } from 'react';
import { api, type SkillSummary } from '@/lib/api';

export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api.skills();
      setSkills(res.skills);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function toggle(name: string, next: boolean) {
    try {
      await api.setSkillEnabled(name, next);
      setSkills((prev) => prev.map((s) => (s.name === name ? { ...s, enabled: next } : s)));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Skills</h1>
        <p className="text-sm text-white/60 mt-1">
          Click a skill to toggle. Changes apply to the running session only.
        </p>
      </header>

      {error && <div className="border border-red-500/40 text-red-300 rounded p-3 text-sm">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {skills.map((s) => (
          <button
            key={s.name}
            onClick={() => toggle(s.name, !s.enabled)}
            className={`text-left border rounded p-4 transition ${
              s.enabled
                ? 'border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/10'
                : 'border-white/10 bg-white/5 hover:bg-white/10 opacity-60'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">{s.name}</span>
              <span className="text-xs text-white/50">v{s.version} · minTier {s.minTier}</span>
            </div>
            <p className="text-sm text-white/70 mt-1">{s.description}</p>
            <div className="flex gap-2 mt-2 text-xs text-white/40">
              {s.triggers.map((t) => (
                <span key={t} className="px-1.5 py-0.5 rounded bg-white/10">
                  {t}
                </span>
              ))}
              {s.invocable && <span className="px-1.5 py-0.5 rounded bg-white/10">invocable</span>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

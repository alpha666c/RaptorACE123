'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { usePermissionRequests } from '@/lib/permission-requests';

/**
 * Global approval listener + modal. Mounted at the root layout so the modal
 * pops on any page when a permission request fires. Safe to render even when
 * the server is unreachable — the SSE subscription just stays quiet.
 */
export function ApprovalModal() {
  const { pending, dismiss } = usePermissionRequests();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current = pending[0];
  if (!current) return null;

  async function decide(action: 'allow-once' | 'allow-session' | 'deny') {
    if (!current) return;
    setBusy(action);
    setError(null);
    try {
      await api.decide(current.requestId, action);
      dismiss(current.requestId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur">
      <div className="w-[min(90vw,540px)] border border-white/20 bg-[#0b0c10] rounded p-6 space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Approval required</h2>
          <div className="text-xs text-white/50">
            {pending.length > 1 ? `+${pending.length - 1} more queued` : ''}
          </div>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex gap-2">
            <span className="text-white/50 w-24 shrink-0">Tool</span>
            <span className="mono">{current.tool}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-white/50 w-24 shrink-0">Tier</span>
            <span>
              T{current.currentTier} → <span className="text-amber-300">T{current.requiredTier}</span>
            </span>
          </div>
          <div className="flex gap-2">
            <span className="text-white/50 w-24 shrink-0">Reason</span>
            <span className="text-white/80">{current.reason}</span>
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer text-white/50 hover:text-white">Tool args</summary>
            <pre className="mt-2 p-2 rounded bg-white/5 overflow-auto max-h-48 mono text-xs">
              {JSON.stringify(current.args, null, 2)}
            </pre>
          </details>
        </div>

        {error && (
          <div className="border border-red-500/40 text-red-300 rounded p-2 text-xs">{error}</div>
        )}

        <div className="flex gap-2 justify-end pt-2">
          <button
            onClick={() => decide('deny')}
            disabled={busy !== null}
            className="px-3 py-2 rounded text-sm border border-white/20 hover:bg-white/5 disabled:opacity-40"
          >
            {busy === 'deny' ? 'Denying…' : 'Deny'}
          </button>
          <button
            onClick={() => decide('allow-once')}
            disabled={busy !== null}
            className="px-3 py-2 rounded text-sm border border-white/20 hover:bg-white/5 disabled:opacity-40"
          >
            {busy === 'allow-once' ? 'Allowing…' : 'Allow once'}
          </button>
          <button
            onClick={() => decide('allow-session')}
            disabled={busy !== null}
            className="px-3 py-2 rounded text-sm bg-emerald-500/80 hover:bg-emerald-500 text-black font-medium disabled:opacity-40"
          >
            {busy === 'allow-session' ? 'Allowing…' : 'Allow this session'}
          </button>
        </div>
      </div>
    </div>
  );
}

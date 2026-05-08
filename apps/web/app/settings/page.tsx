'use client';
import { useEffect, useState } from 'react';
import { api, getServerUrl, getToken, setServerUrl, setToken } from '@/lib/api';

export default function SettingsPage() {
  const [url, setUrl] = useState('');
  const [token, setTokenState] = useState('');
  const [status, setStatus] = useState<'idle' | 'testing' | 'ok' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setUrl(getServerUrl());
    setTokenState(getToken());
  }, []);

  async function save() {
    setServerUrl(url.trim());
    setToken(token.trim());
    setStatus('testing');
    setError(null);
    try {
      await api.health();
      setStatus('ok');
    } catch (e) {
      setStatus('failed');
      setError((e as Error).message);
    }
  }

  return (
    <div className="space-y-6 max-w-xl">
      <header>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-white/60 mt-1">
          Paste the URL and token shown by
          <code className="mono text-xs"> Personal Agent: Show Web Server URL + Token</code>
          in VS Code.
        </p>
      </header>

      <div className="space-y-4">
        <div>
          <label className="block text-xs text-white/60 mb-1">Server URL</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://127.0.0.1:23456"
            className="w-full border border-white/10 rounded px-3 py-2 bg-white/5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-white/60 mb-1">Bearer token</label>
          <input
            value={token}
            onChange={(e) => setTokenState(e.target.value)}
            type="password"
            placeholder="64-hex-char token"
            className="w-full border border-white/10 rounded px-3 py-2 bg-white/5 text-sm mono"
          />
        </div>
        <button
          onClick={save}
          className="px-4 py-2 rounded bg-white text-black text-sm font-medium hover:bg-white/90"
        >
          Save + test connection
        </button>
        {status === 'ok' && <div className="text-emerald-400 text-sm">Connected ✓</div>}
        {status === 'failed' && (
          <div className="text-red-400 text-sm">Failed: {error ?? 'unknown error'}</div>
        )}
      </div>
    </div>
  );
}

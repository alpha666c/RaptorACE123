'use client';

/**
 * Client-side API wrapper that targets the local agent server started by the
 * VS Code extension (http://127.0.0.1:23456 by default). URL + token are
 * stored in localStorage and entered by the user on first load — see
 * apps/web/app/settings/page.tsx.
 */

const URL_KEY = 'agent.server.url';
const TOKEN_KEY = 'agent.server.token';

export function getServerUrl(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(URL_KEY) ?? 'http://127.0.0.1:23456';
}
export function setServerUrl(url: string): void {
  localStorage.setItem(URL_KEY, url);
}
export function getToken(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(TOKEN_KEY) ?? '';
}
export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${getServerUrl()}${path}`;
  const token = getToken();
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(res.status, text || res.statusText);
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  health: () => request<{ ok: boolean; version: string }>('/api/health'),
  sessions: (limit = 20) => request<{ sessions: SessionRecord[] }>(`/api/sessions?limit=${limit}`),
  facts: (opts: { query?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.query) q.set('query', opts.query);
    if (opts.limit) q.set('limit', String(opts.limit));
    return request<{ facts: Fact[] }>(`/api/memory/facts?${q}`);
  },
  createFact: (input: FactInput) =>
    request<{ fact: Fact }>('/api/memory/facts', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  alwaysLoaded: () =>
    request<{ claudeMd: string | null; preferences: string | null; conventions: string | null; architecture: string | null }>(
      '/api/memory/always-loaded',
    ),
  skills: () => request<{ skills: SkillSummary[] }>('/api/skills'),
  setSkillEnabled: (name: string, enabled: boolean) =>
    request<{ ok: true; enabled: boolean }>(`/api/skills/${encodeURIComponent(name)}/enabled`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
  mcpServers: () => request<{ servers: McpServerSummary[] }>('/api/mcp/servers'),
  models: () => request<{ aliases: ModelAlias[] }>('/api/models'),
  permissions: () =>
    request<{ currentTier: number; readOnlyKillSwitch: boolean; pendingApprovals: string[] }>(
      '/api/permissions',
    ),
  setTier: (tier: number) =>
    request<{ ok: true; tier: number }>('/api/permissions/tier', {
      method: 'POST',
      body: JSON.stringify({ tier }),
    }),
  decide: (requestId: string, action: 'allow-once' | 'allow-session' | 'deny') =>
    request<{ ok: true }>('/api/permissions/decide', {
      method: 'POST',
      body: JSON.stringify({ requestId, action }),
    }),
  chat: (message: string) =>
    request<{ text: string }>('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),
};

export interface SessionRecord {
  id: string;
  projectRoot: string;
  startedAt: number;
  endedAt: number | null;
  summary: string | null;
  tier: number;
}
export interface Fact {
  id: string;
  kind: 'preference' | 'convention' | 'decision' | 'fact';
  title: string;
  body: string;
  tags: string[];
  source: string;
  confidence: number;
  createdAt: number;
  updatedAt: number;
}
export interface FactInput {
  kind: Fact['kind'];
  title: string;
  body: string;
  tags?: string[];
  confidence?: number;
}
export interface SkillSummary {
  name: string;
  description: string;
  version: string;
  triggers: string[];
  enabled: boolean;
  minTier: number;
  invocable: boolean;
}
export interface McpServerSummary {
  name: string;
  tools: Array<{ name: string; description: string }>;
}
export interface ModelAlias {
  alias: string;
  modelId: string;
  pricing: { inputPerMillion: number; outputPerMillion: number } | null;
}

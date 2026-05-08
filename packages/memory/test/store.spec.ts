import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MemoryStore } from '../src/store.js';

let tmpRoot: string;
let store: MemoryStore;

beforeEach(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-memory-'));
  store = await MemoryStore.create(tmpRoot);
});

afterEach(() => {
  store.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('MemoryStore — always-loaded files', () => {
  it('returns nulls when no memory files exist', () => {
    const loaded = store.loadAlwaysLoaded();
    expect(loaded.claudeMd).toBeNull();
    expect(loaded.preferences).toBeNull();
    expect(loaded.conventions).toBeNull();
    expect(loaded.architecture).toBeNull();
  });

  it('loads CLAUDE.md + preferences.md + conventions.md when present', () => {
    fs.writeFileSync(path.join(tmpRoot, 'CLAUDE.md'), '# repo conventions');
    fs.writeFileSync(path.join(tmpRoot, '.agent/memory/preferences.md'), '- use pnpm');
    fs.writeFileSync(path.join(tmpRoot, '.agent/memory/conventions.md'), '- 2-space indent');
    const loaded = store.loadAlwaysLoaded();
    expect(loaded.claudeMd).toBe('# repo conventions');
    expect(loaded.preferences).toBe('- use pnpm');
    expect(loaded.conventions).toBe('- 2-space indent');
  });
});

describe('MemoryStore — writeFact + listFacts', () => {
  it('stores a fact in SQLite and on disk', () => {
    const fact = store.writeFact({
      kind: 'preference',
      title: 'indentation',
      body: '2 spaces, not tabs.',
      tags: ['style'],
    });
    expect(fact.id).toMatch(/^fact_/);
    expect(fact.path).toBeTruthy();
    expect(fs.existsSync(fact.path!)).toBe(true);
    const listed = store.listFacts();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.title).toBe('indentation');
  });
});

describe('MemoryStore — keyword search', () => {
  beforeEach(() => {
    store.writeFact({ kind: 'preference', title: 'indentation', body: '2 spaces, not tabs.', tags: ['style'] });
    store.writeFact({ kind: 'convention', title: 'zod everywhere', body: 'Validate tool args with zod schemas.', tags: ['validation'] });
    store.writeFact({ kind: 'decision', title: 'use pnpm', body: 'Monorepo uses pnpm workspaces, not yarn.', tags: ['tooling'] });
  });

  it('finds facts matching a query term', () => {
    const results = store.searchFacts('pnpm');
    expect(results.some((f) => f.title === 'use pnpm')).toBe(true);
  });

  it('returns empty for a query with no matches', () => {
    const results = store.searchFacts('unrelatedxyz');
    expect(results).toHaveLength(0);
  });

  it('returns empty for a short/empty query instead of throwing', () => {
    expect(store.searchFacts('')).toEqual([]);
    expect(store.searchFacts('a')).toEqual([]);
  });

  it('tolerates quotes in the query without crashing', () => {
    expect(() => store.searchFacts('"pnpm"')).not.toThrow();
    expect(() => store.searchFacts("don't crash")).not.toThrow();
  });
});

describe('MemoryStore — sessions + turns', () => {
  it('records a session and its turns, then lists them', () => {
    store.startSession({ id: 'sess_1', projectRoot: tmpRoot, tier: 0 });
    store.recordTurn({
      id: 'turn_1',
      sessionId: 'sess_1',
      userMessage: 'hi',
      assistantMessage: 'hello',
      toolCalls: [{ name: 'fs.read', durationMs: 10 }],
      inputTokens: 100,
      outputTokens: 20,
      costUsd: 0.001,
      model: 'anthropic/claude-sonnet-4.6',
      taskType: 'implement',
      startedAt: Date.now(),
      endedAt: Date.now(),
      error: null,
    });
    store.endSession('sess_1', 'brief test');
    const sessions = store.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.summary).toBe('brief test');
    expect(sessions[0]?.endedAt).toBeTypeOf('number');
  });
});

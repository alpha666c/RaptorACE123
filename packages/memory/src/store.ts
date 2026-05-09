import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import initSqlJs, { type Database as SqlJsDb, type SqlJsStatic } from 'sql.js';
import { getLogger, hashContent, newId } from '@agent/shared';
import { layoutFor, type MemoryLayout } from './layout.js';
import { SCHEMA_SQL } from './schema.js';
import {
  type ActivityEntry,
  type AlwaysLoadedMemory,
  type Fact,
  type FactInput,
  FactInputSchema,
  type SessionRecord,
  type TurnRecord,
} from './types.js';

const MAX_ACTIVITY_ENTRIES = 500;
const ACTIVITY_HEADER =
  '# Agent activity log\n<!-- Format: `- YYYY-MM-DD HH:MM | sess | kind | summary | files` (newest first). Auto-maintained; the agent reads the tail before each turn. -->\n\n';

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
function formatActivityLine(e: ActivityEntry): string {
  const d = new Date(e.timestamp);
  const stamp = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const sess = (e.sessionId || '').replace(/^sess_/, '').slice(0, 6) || 'anon';
  const kind = (e.kind || 'change').slice(0, 10);
  const summary = e.summary.replace(/\s+/g, ' ').trim().slice(0, 100) || '(no summary)';
  const files = (e.files ?? []).slice(0, 5).join(', ').slice(0, 140);
  return `- ${stamp} | ${sess} | ${kind} | ${summary}${files ? ` | ${files}` : ''}`;
}

const log = getLogger('memory');

// sql.js is WASM — pure JS + WebAssembly. Runs identically in any Node version
// (no native ABI mismatch with VS Code's bundled Node) and on any platform.
// One-time WASM init; cached across calls.
/**
 * Best-effort discovery of sql.js's WASM file. Used as a fallback when the
 * caller doesn't supply `sqlJsWasmPath` — e.g. plain ESM tests. The extension
 * passes the path explicitly (it knows where its own node_modules live),
 * which avoids the whole import.meta/__dirname mess in CJS bundles.
 */
function autodetectSqlJsWasmPath(): string {
  const errors: string[] = [];
  // Runtime `require` is a module-local closure, not on globalThis. Access via
  // eval so bundlers don't rewrite it; if we're in ESM, eval will throw.
  try {
    // biome-ignore lint/security/noGlobalEval: intentional runtime-env check
    const cjsReq = eval('typeof require === "function" ? require : null') as
      | NodeJS.Require
      | null;
    if (cjsReq) return path.join(path.dirname(cjsReq.resolve('sql.js')), 'sql-wasm.wasm');
    errors.push('cjs: require is not a function');
  } catch (e) {
    errors.push(`cjs: ${(e as Error).message}`);
  }
  try {
    // biome-ignore lint/security/noGlobalEval: needed to access import.meta in a bundler-safe way
    const metaUrl = eval('typeof import.meta !== "undefined" ? import.meta.url : null') as
      | string
      | null;
    if (metaUrl) {
      const req = createRequire(metaUrl);
      return path.join(path.dirname(req.resolve('sql.js')), 'sql-wasm.wasm');
    }
    errors.push('esm: import.meta.url unavailable');
  } catch (e) {
    errors.push(`esm: ${(e as Error).message}`);
  }
  // Walk up from cwd looking for node_modules/sql.js/dist/sql-wasm.wasm.
  try {
    let cursor = process.cwd();
    for (let i = 0; i < 15; i++) {
      const candidate = path.join(cursor, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
      if (fs.existsSync(candidate)) return candidate;
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
    errors.push('walk: not found in any cwd ancestor');
  } catch (e) {
    errors.push(`walk: ${(e as Error).message}`);
  }
  throw new Error(`Cannot locate sql.js: ${errors.join(' | ')}`);
}

let sqlModule: Promise<SqlJsStatic> | null = null;
function loadSqlJs(wasmPath: string | undefined): Promise<SqlJsStatic> {
  if (sqlModule) return sqlModule;
  const resolvedPath = wasmPath ?? autodetectSqlJsWasmPath();
  const nodeBuf = fs.readFileSync(resolvedPath);
  // sql.js typings say ArrayBuffer; slice out the Node Buffer's exact byte range.
  const wasmBinary = nodeBuf.buffer.slice(
    nodeBuf.byteOffset,
    nodeBuf.byteOffset + nodeBuf.byteLength,
  ) as ArrayBuffer;
  sqlModule = initSqlJs({ wasmBinary });
  return sqlModule;
}

export interface MemoryStoreOptions {
  /**
   * Absolute path to sql.js's `sql-wasm.wasm` binary. When provided, skips the
   * autodetection logic — callers that know where their own `node_modules` live
   * (e.g. a VS Code extension resolving via `__filename`) should supply this.
   */
  sqlJsWasmPath?: string;
}

// Unused in the new surface; fileURLToPath was only used inside the old walk.
void fileURLToPath;

/**
 * Per-project memory store. Opens (or creates) `<projectRoot>/.agent/index.sqlite`
 * and the `<projectRoot>/.agent/memory/` markdown directory on first use.
 *
 * Use the async `MemoryStore.create(projectRoot)` factory — sql.js initialises
 * WASM asynchronously.
 */
export class MemoryStore {
  readonly layout: MemoryLayout;
  private db: SqlJsDb;
  private dirtyWrites = 0;

  private constructor(layout: MemoryLayout, db: SqlJsDb) {
    this.layout = layout;
    this.db = db;
  }

  static async create(projectRoot: string, options: MemoryStoreOptions = {}): Promise<MemoryStore> {
    const layout = layoutFor(projectRoot);
    fs.mkdirSync(layout.memoryDir, { recursive: true });
    fs.mkdirSync(layout.decisionsDir, { recursive: true });
    fs.mkdirSync(layout.factsDir, { recursive: true });

    const SQL = await loadSqlJs(options.sqlJsWasmPath);
    let db: SqlJsDb;
    try {
      const existing = fs.readFileSync(layout.sqlitePath);
      db = new SQL.Database(existing);
    } catch {
      db = new SQL.Database();
    }
    db.exec(SCHEMA_SQL);

    const store = new MemoryStore(layout, db);
    store.persist();
    log.debug({ sqlitePath: layout.sqlitePath }, 'memory.store.opened');
    return store;
  }

  close(): void {
    try {
      this.persist();
      this.db.close();
    } catch (e) {
      log.warn({ err: (e as Error).message }, 'memory.store.close.failed');
    }
  }

  /** Write the current DB snapshot to disk atomically. */
  private persist(): void {
    const buf = this.db.export();
    const tmp = `${this.layout.sqlitePath}.tmp`;
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, this.layout.sqlitePath);
    this.dirtyWrites = 0;
  }

  private markDirty(): void {
    this.dirtyWrites++;
    // Persist every write for correctness. SQLite files are small for our scale
    // (< a few MB) so the rewrite cost is acceptable. A future optimisation can
    // debounce this on a timer or WAL-like delta log.
    this.persist();
  }

  // ---------- Always-loaded files ----------

  loadAlwaysLoaded(): AlwaysLoadedMemory {
    return {
      claudeMd: this.readIfExists(this.layout.claudeMd),
      preferences: this.readIfExists(this.layout.preferencesMd),
      conventions: this.readIfExists(this.layout.conventionsMd),
      architecture: this.readIfExists(this.layout.architectureMd),
    };
  }

  private readIfExists(p: string): string | null {
    try {
      return fs.readFileSync(p, 'utf8');
    } catch {
      return null;
    }
  }

  // ---------- Facts: write ----------

  writeFact(input: FactInput): Fact {
    const parsed = FactInputSchema.parse(input);
    const now = Date.now();
    const id = newId('fact');
    const hash = hashContent(`${parsed.kind}:${parsed.title}:${parsed.body}`);
    const filename = `${parsed.kind}-${hash}.md`;
    const filePath = path.join(this.layout.factsDir, filename);
    const tagsJson = JSON.stringify(parsed.tags);

    const stmt = this.db.prepare(`
      INSERT INTO facts (id, kind, title, body, tags_json, path, source, confidence, created_at, updated_at, project_root)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    try {
      stmt.run([
        id,
        parsed.kind,
        parsed.title,
        parsed.body,
        tagsJson,
        filePath,
        parsed.source,
        parsed.confidence,
        now,
        now,
        this.layout.projectRoot,
      ]);
    } finally {
      stmt.free();
    }

    const md = renderFactMarkdown({
      kind: parsed.kind,
      title: parsed.title,
      body: parsed.body,
      tags: parsed.tags,
      createdAt: now,
      confidence: parsed.confidence,
      source: parsed.source,
    });
    fs.writeFileSync(filePath, md, 'utf8');
    this.markDirty();

    return {
      id,
      kind: parsed.kind,
      title: parsed.title,
      body: parsed.body,
      tags: parsed.tags,
      path: filePath,
      source: parsed.source,
      confidence: parsed.confidence,
      createdAt: now,
      updatedAt: now,
      projectRoot: this.layout.projectRoot,
    };
  }

  // ---------- Facts: read ----------

  listFacts(limit = 50): Fact[] {
    return this.runQuery(
      `SELECT id, kind, title, body, tags_json, path, source, confidence, created_at, updated_at, project_root
       FROM facts WHERE project_root = ? ORDER BY updated_at DESC LIMIT ?`,
      [this.layout.projectRoot, limit],
    ).map(rowToFact);
  }

  /**
   * Keyword search over title + body + tags.
   * Splits the query on whitespace; each token must match somewhere (AND).
   * Ranking is recency-based (updated_at DESC) — no BM25 without FTS5, but at
   * personal scale this is plenty. Swap to FTS5 or embeddings in a later milestone.
   */
  searchFacts(query: string, limit = 8): Fact[] {
    const tokens = query
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);
    if (tokens.length === 0) return [];

    const conditions: string[] = [];
    const params: unknown[] = [this.layout.projectRoot];
    for (const tok of tokens) {
      const like = `%${escapeLike(tok)}%`;
      conditions.push(`(LOWER(title) LIKE ? ESCAPE '\\' OR LOWER(body) LIKE ? ESCAPE '\\' OR LOWER(tags_json) LIKE ? ESCAPE '\\')`);
      params.push(like, like, like);
    }
    params.push(limit);

    try {
      return this.runQuery(
        `SELECT id, kind, title, body, tags_json, path, source, confidence, created_at, updated_at, project_root
         FROM facts
         WHERE project_root = ? AND ${conditions.join(' AND ')}
         ORDER BY updated_at DESC
         LIMIT ?`,
        params,
      ).map(rowToFact);
    } catch (e) {
      log.warn({ err: (e as Error).message, query }, 'memory.search.failed');
      return [];
    }
  }

  // ---------- Sessions + turns ----------

  startSession(session: { id: string; projectRoot: string; tier: number }): void {
    const stmt = this.db.prepare(
      `INSERT INTO sessions (id, project_root, started_at, tier) VALUES (?, ?, ?, ?)`,
    );
    try {
      stmt.run([session.id, session.projectRoot, Date.now(), session.tier]);
    } finally {
      stmt.free();
    }
    this.markDirty();
  }

  endSession(id: string, summary?: string): void {
    const stmt = this.db.prepare(
      `UPDATE sessions SET ended_at = ?, summary = ? WHERE id = ?`,
    );
    try {
      stmt.run([Date.now(), summary ?? null, id]);
    } finally {
      stmt.free();
    }
    this.markDirty();
  }

  recordTurn(t: Omit<TurnRecord, 'toolCallsJson'> & { toolCalls: unknown[] }): void {
    const stmt = this.db.prepare(
      `INSERT INTO turns (id, session_id, user_message, assistant_message, tool_calls_json, input_tokens, output_tokens, cost_usd, model, task_type, started_at, ended_at, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    try {
      stmt.run([
        t.id,
        t.sessionId,
        t.userMessage,
        t.assistantMessage,
        JSON.stringify(t.toolCalls),
        t.inputTokens,
        t.outputTokens,
        t.costUsd,
        t.model,
        t.taskType,
        t.startedAt,
        t.endedAt,
        t.error,
      ]);
    } finally {
      stmt.free();
    }
    this.markDirty();
  }

  listSessions(limit = 20): SessionRecord[] {
    const rows = this.runQuery(
      `SELECT id, project_root, started_at, ended_at, summary, tier
       FROM sessions WHERE project_root = ? ORDER BY started_at DESC LIMIT ?`,
      [this.layout.projectRoot, limit],
    );
    return rows.map((r) => ({
      id: r['id'] as string,
      projectRoot: r['project_root'] as string,
      startedAt: r['started_at'] as number,
      endedAt: (r['ended_at'] as number | null) ?? null,
      summary: (r['summary'] as string | null) ?? null,
      tier: r['tier'] as number,
    }));
  }

  // ---------- Activity log (universal changelog) ----------

  /**
   * Append one terse line to `.agent/CHANGELOG.md`. Entry format:
   *   `- YYYY-MM-DD HH:MM | sess | kind | summary | files`
   *
   * Keeps the file newest-first. Trims to MAX_ACTIVITY_ENTRIES (500) so it
   * never grows unbounded. Safe to call for every real-work turn.
   */
  appendActivityEntry(entry: ActivityEntry): void {
    const line = formatActivityLine(entry);
    let existing = '';
    try {
      existing = fs.readFileSync(this.layout.changelogMd, 'utf8');
    } catch {
      // Fresh file; that's fine.
    }
    const header = ACTIVITY_HEADER;
    const body = existing.startsWith(header)
      ? existing.slice(header.length).trimStart()
      : existing.trimStart();
    const prior = body
      .split('\n')
      .filter((l) => l.startsWith('- '))
      .slice(0, MAX_ACTIVITY_ENTRIES - 1);
    const next = `${header}${line}\n${prior.join('\n')}${prior.length > 0 ? '\n' : ''}`;
    fs.writeFileSync(this.layout.changelogMd, next, 'utf8');
  }

  /**
   * Return the tail of the activity log formatted for system-prompt injection
   * (newest first, `maxChars` hard cap). Strips the header + keeps only the
   * lines. Returns null if nothing logged yet.
   */
  loadActivityLog(maxChars = 3500): string | null {
    let content: string;
    try {
      content = fs.readFileSync(this.layout.changelogMd, 'utf8');
    } catch {
      return null;
    }
    const body = content.startsWith(ACTIVITY_HEADER)
      ? content.slice(ACTIVITY_HEADER.length)
      : content;
    const lines = body.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length === 0) return null;
    // Take lines from the top (newest first) until we hit the char budget.
    const out: string[] = [];
    let used = 0;
    for (const l of lines) {
      if (used + l.length + 1 > maxChars) break;
      out.push(l);
      used += l.length + 1;
    }
    return out.join('\n');
  }

  // ---------- Helpers ----------

  private runQuery(sql: string, params: unknown[]): Array<Record<string, unknown>> {
    const stmt = this.db.prepare(sql);
    const rows: Array<Record<string, unknown>> = [];
    try {
      stmt.bind(params as never);
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as Record<string, unknown>);
      }
    } finally {
      stmt.free();
    }
    return rows;
  }
}

function rowToFact(r: Record<string, unknown>): Fact {
  return {
    id: r['id'] as string,
    kind: r['kind'] as Fact['kind'],
    title: r['title'] as string,
    body: r['body'] as string,
    tags: safeParseStringArray(r['tags_json'] as string),
    path: (r['path'] as string | null) ?? null,
    source: r['source'] as string,
    confidence: r['confidence'] as number,
    createdAt: r['created_at'] as number,
    updatedAt: r['updated_at'] as number,
    projectRoot: r['project_root'] as string,
  };
}

function safeParseStringArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

interface RenderArgs {
  kind: string;
  title: string;
  body: string;
  tags: string[];
  createdAt: number;
  confidence: number;
  source: string;
}

function renderFactMarkdown(r: RenderArgs): string {
  const frontmatter = [
    '---',
    `kind: ${r.kind}`,
    `title: ${JSON.stringify(r.title)}`,
    `tags: [${r.tags.map((t) => JSON.stringify(t)).join(', ')}]`,
    `created_at: ${new Date(r.createdAt).toISOString()}`,
    `confidence: ${r.confidence}`,
    `source: ${r.source}`,
    '---',
    '',
  ].join('\n');
  return `${frontmatter}${r.body}\n`;
}

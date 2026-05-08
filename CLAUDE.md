# Personal Coding Agent — Repo Conventions

This file is always loaded into the agent's context. Keep it small and high-signal.

## Scope

The agent operates only inside approved project roots. It never touches files outside the VS Code workspace folders (extension) or the server's allowlist (web). Safety is enforced at the tool layer — every fs/shell/git/network tool calls `assertInsideRoots` before I/O.

## Stack

- TypeScript + Node 24
- pnpm workspaces monorepo
- Vercel AI SDK for LLM plumbing; custom agent loop on top
- OpenRouter as the primary model gateway
- SQLite via better-sqlite3 for local state; markdown for human-readable memory
- zod for all schemas (tool args, manifests, config)
- biome for lint+format; vitest for tests

## Packages

Logic lives in `packages/*`. `apps/*` are thin surface wrappers (extension, web).
Never import tool modules directly — go through `ToolRegistry.execute()`.
Never import provider SDKs outside `@agent/model-gateway`.

## Conventions

- All paths must be absolute when crossing package boundaries.
- All tool args validated with zod before execution.
- No `any` unless commented with a reason. Prefer `unknown` + a narrowing check.
- Errors thrown from tools are typed; do not swallow.
- Logs go through `@agent/shared` logger — never `console.*` in library code.

## Testing

- `packages/tools/test/scoping.spec.ts` is mandatory — attack vectors must pass before any write tool ships.
- Run tests: `pnpm test`.
- Run typecheck: `pnpm typecheck`.
- Build all: `pnpm build`.

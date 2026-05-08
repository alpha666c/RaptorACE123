# Personal Coding Agent

A private, production-grade personal coding agent built as a VS Code extension, with a companion local web app for oversight.

## Features

- **Scoped filesystem tools** — reads, writes, globs, greps only inside workspace folders. Every path goes through a scope check with attack-vector tests (symlink escape, `..`, unicode tricks).
- **7-tier permission system** — from read-only to destructive, with approval prompts and per-session upgrades.
- **OpenRouter model gateway** — routes task types (plan, implement, review, summarize) to different models with cost observability.
- **Memory** — SQLite + markdown hybrid, auto-saved via a memory-summarizer skill gated by a secret scanner.
- **MCP supervisor** — spawns and tier-wraps external MCP servers (Context7, Notion, sequential-thinking, etc.).
- **17 built-in skills** — memory-summarizer, code-review, commit-message, pr-description, typecheck-fix, test-runner-loop, dep-audit, error-explainer, refactor, architecture-review, migration, release-checklist, ui-ux-critique, test-gen, context-retrieval, docs-lookup, plan-first.
- **Optional council mode** — architect → safety → implementer → reviewer → synthesis for complex asks.
- **Local web UI** — on `127.0.0.1` with bearer-token auth, for browsing memory, toggling skills, watching live events.

## Install

```bash
code --install-extension personal-coding-agent-extension-0.1.0.vsix
```

Or via the VS Code UI: **Extensions → Install from VSIX…**

## Quick start

1. Command Palette → **Personal Agent: Set OpenRouter API Key** → paste your key (stored in OS keychain).
2. Command Palette → **Personal Agent: Open Chat**.
3. Ask the agent things. It reads / writes / runs in your workspace subject to permission prompts.

## License

MIT.

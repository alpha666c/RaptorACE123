# Test Workspace

This folder is the default workspace opened in the Extension Development Host
when you press F5 on the main project. It gives the agent some files to read
and edit so you can exercise the M1 deliverable end-to-end.

## Exercises

1. **Read-only (tier 0)** — Ask: "What's in this workspace?"
   The agent should call `fs.glob` and list the files without any approval prompt.

2. **Grep (tier 0)** — Ask: "Find every TODO comment in this workspace."
   The agent should call `fs.grep`.

3. **Edit (tier 2)** — Ask: "Refactor `src/greet.ts` to take a second parameter for the greeting word, with a default of 'Hello'."
   The agent should propose an `fs.edit` call. A diff-preview panel opens. A quickpick
   asks whether to allow once, allow for the session, raise the tier, or deny.

4. **Scope boundary** — Ask: "Read the file at `/etc/hosts`."
   The tool layer rejects it before the model can execute the read. The agent
   should explain it can't reach outside the workspace.

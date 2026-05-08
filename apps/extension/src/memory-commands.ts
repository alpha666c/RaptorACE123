import * as vscode from 'vscode';
import type { MemoryStore } from '@agent/memory';

export async function promptSaveMemory(memory: MemoryStore): Promise<void> {
  const kind = await vscode.window.showQuickPick(
    [
      { label: 'preference', description: 'A user preference (e.g. "prefer pnpm over yarn")' },
      { label: 'convention', description: 'A project convention (e.g. "use zod for all tool args")' },
      { label: 'decision', description: 'A decision with rationale (e.g. "chose SQLite for M2")' },
      { label: 'fact', description: 'A stable fact worth remembering' },
    ],
    { title: 'Save memory — kind', placeHolder: 'What kind of thing is this?', ignoreFocusOut: true },
  );
  if (!kind) return;

  const title = await vscode.window.showInputBox({
    title: 'Save memory — title',
    prompt: 'Short title (under 200 chars)',
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim().length === 0 ? 'Required' : v.length > 200 ? 'Too long' : undefined),
  });
  if (!title) return;

  const body = await vscode.window.showInputBox({
    title: 'Save memory — body',
    prompt: 'Full content (under 4000 chars). Will be injected into future sessions.',
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim().length === 0 ? 'Required' : v.length > 4000 ? 'Too long' : undefined),
  });
  if (!body) return;

  const tagsRaw = await vscode.window.showInputBox({
    title: 'Save memory — tags (optional)',
    prompt: 'Comma-separated tags, or leave empty',
    ignoreFocusOut: true,
  });
  const tags = (tagsRaw ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const kindValue = kind.label as 'preference' | 'convention' | 'decision' | 'fact';
  try {
    const fact = memory.writeFact({ kind: kindValue, title, body, tags });
    vscode.window.showInformationMessage(`Memory saved: [${fact.kind}] ${fact.title}`);
  } catch (e) {
    vscode.window.showErrorMessage(`Failed to save memory: ${(e as Error).message}`);
  }
}

export async function showMemoryList(memory: MemoryStore): Promise<void> {
  const facts = memory.listFacts(50);
  if (facts.length === 0) {
    vscode.window.showInformationMessage('No memory facts yet. Save one with "Personal Agent: Save Memory Fact".');
    return;
  }
  const picked = await vscode.window.showQuickPick(
    facts.map((f) => ({
      label: `[${f.kind}] ${f.title}`,
      description: f.tags.join(', '),
      detail: f.body.slice(0, 200),
      fact: f,
    })),
    { title: `Memory facts (${facts.length})`, placeHolder: 'Select a fact to open' },
  );
  if (picked?.fact.path) {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(picked.fact.path));
    await vscode.window.showTextDocument(doc);
  }
}

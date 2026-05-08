import * as vscode from 'vscode';

/**
 * Open a read-only webview panel showing a diff preview.
 * Resolves when the panel is disposed (user has seen it).
 * Actual approve/deny happens via the quickpick that follows in the caller.
 */
export async function showDiffPreview(title: string, diffText: string): Promise<void> {
  return new Promise((resolve) => {
    const panel = vscode.window.createWebviewPanel(
      'personalAgent.diff',
      `Agent diff: ${title}`,
      vscode.ViewColumn.Beside,
      { enableScripts: false, retainContextWhenHidden: false },
    );
    panel.webview.html = renderDiffHtml(title, diffText);
    panel.onDidDispose(() => resolve());
    // auto-dispose after 30s to avoid leaks if user ignores it
    setTimeout(() => panel.dispose(), 30_000);
  });
}

function renderDiffHtml(title: string, diff: string): string {
  const esc = (s: string) =>
    s
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  const lines = diff.split('\n').map((ln) => {
    const cls = ln.startsWith('+') ? 'add' : ln.startsWith('-') ? 'del' : ln.startsWith('@@') ? 'hunk' : '';
    return `<div class="line ${cls}">${esc(ln) || '&nbsp;'}</div>`;
  });
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: var(--vscode-editor-font-family), monospace; font-size: 12px; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); margin: 0; padding: 8px; }
    h3 { margin: 0 0 8px 0; font-size: 13px; font-weight: 600; }
    .line { white-space: pre; }
    .add { background: rgba(46, 160, 67, 0.15); }
    .del { background: rgba(248, 81, 73, 0.15); }
    .hunk { color: var(--vscode-descriptionForeground); }
  </style></head><body><h3>${esc(title)}</h3>${lines.join('')}</body></html>`;
}

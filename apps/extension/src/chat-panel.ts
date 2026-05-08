import * as vscode from 'vscode';
import type { AgentHost, CoreMessage } from '@agent/core';
import type { AgentEvent } from '@agent/shared';

export class ChatPanel {
  private panel: vscode.WebviewPanel;
  private disposed = false;
  private currentController: AbortController | undefined;
  private history: CoreMessage[] = [];
  private unsubscribe: (() => void) | undefined;

  constructor(
    private context: vscode.ExtensionContext,
    private host: AgentHost,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'personalAgent.chat',
      'Personal Coding Agent',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.webview.html = this.renderHtml();
    this.panel.onDidDispose(() => this.dispose());
    this.panel.webview.onDidReceiveMessage(this.handleMessage.bind(this));
    this.unsubscribe = host.onEvent((ev) => this.forwardEvent(ev));
  }

  reveal(): void {
    this.panel.reveal();
  }

  private handleMessage(msg: unknown): void {
    if (!msg || typeof msg !== 'object') return;
    const m = msg as { kind?: string; text?: string };
    switch (m.kind) {
      case 'user.message':
        if (typeof m.text === 'string') void this.runTurn(m.text);
        break;
      case 'cancel':
        this.currentController?.abort();
        break;
    }
  }

  private async runTurn(userText: string): Promise<void> {
    if (this.currentController) {
      vscode.window.showInformationMessage('An agent turn is already running. Cancel it first.');
      return;
    }
    this.currentController = new AbortController();
    this.send({ kind: 'turn.started' });
    try {
      const result = await this.host.run({
        userMessage: userText,
        priorMessages: this.history,
        signal: this.currentController.signal,
      });
      this.history = result.messages;
      this.send({ kind: 'turn.complete' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.send({ kind: 'turn.error', error: msg });
    } finally {
      this.currentController = undefined;
    }
  }

  private forwardEvent(ev: AgentEvent): void {
    this.send({ kind: 'agent.event', event: ev });
  }

  private send(payload: unknown): void {
    if (this.disposed) return;
    void this.panel.webview.postMessage(payload);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.currentController?.abort();
    this.unsubscribe?.();
    this.panel.dispose();
  }

  private renderHtml(): string {
    const nonce = randomNonce();
    const csp = [
      "default-src 'none'",
      `style-src ${this.panel.webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${this.panel.webview.cspSource}`,
    ].join('; ');
    return /* html */ `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 12px; display: flex; flex-direction: column; height: 100vh; box-sizing: border-box; }
  #log { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 4px; }
  .msg { padding: 8px 10px; border-radius: 4px; white-space: pre-wrap; word-break: break-word; }
  .user { background: var(--vscode-input-background); }
  .assistant { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-editorWidget-border); }
  .tool { font-family: var(--vscode-editor-font-family), monospace; font-size: 11px; background: transparent; color: var(--vscode-descriptionForeground); border-left: 2px solid var(--vscode-textLink-foreground); padding-left: 6px; }
  .error { color: var(--vscode-errorForeground); }
  .thinking { color: var(--vscode-descriptionForeground); font-style: italic; }
  .thinking::after { content: '…'; animation: dots 1.2s steps(4, end) infinite; }
  @keyframes dots { 0% { content: '.'; } 33% { content: '..'; } 66% { content: '...'; } }
  #inputrow { display: flex; gap: 6px; padding-top: 8px; border-top: 1px solid var(--vscode-editorWidget-border); }
  textarea { flex: 1; resize: none; font: inherit; padding: 6px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 3px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; cursor: pointer; border-radius: 3px; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
</head>
<body>
<div id="log"></div>
<div id="inputrow">
  <textarea id="input" rows="3" placeholder="Ask the agent…"></textarea>
  <button id="send">Send</button>
  <button id="cancel" disabled>Stop</button>
</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const log = document.getElementById('log');
  const input = document.getElementById('input');
  const sendBtn = document.getElementById('send');
  const cancelBtn = document.getElementById('cancel');

  let assistantEl = null;
  let thinkingEl = null;
  let toolEls = new Map();

  function add(cls, text) {
    const d = document.createElement('div');
    d.className = 'msg ' + cls;
    d.textContent = text;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }

  function clearThinking() {
    if (thinkingEl) { thinkingEl.remove(); thinkingEl = null; }
  }

  function send() {
    const t = input.value.trim();
    if (!t) return;
    add('user', t);
    input.value = '';
    vscode.postMessage({ kind: 'user.message', text: t });
    sendBtn.disabled = true;
    cancelBtn.disabled = false;
    assistantEl = null;
    clearThinking();
    thinkingEl = add('thinking', 'thinking');
  }

  sendBtn.addEventListener('click', send);
  cancelBtn.addEventListener('click', () => vscode.postMessage({ kind: 'cancel' }));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
  });

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.kind === 'turn.started') { /* noop */ }
    else if (m.kind === 'turn.complete') { clearThinking(); sendBtn.disabled = false; cancelBtn.disabled = true; }
    else if (m.kind === 'turn.error') { clearThinking(); add('msg error', 'Error: ' + m.error); sendBtn.disabled = false; cancelBtn.disabled = true; }
    else if (m.kind === 'agent.event') { handleAgentEvent(m.event); }
  });

  function handleAgentEvent(ev) {
    switch (ev.kind) {
      case 'message.chunk':
        clearThinking();
        if (!assistantEl) assistantEl = add('assistant', '');
        assistantEl.textContent += ev.text;
        log.scrollTop = log.scrollHeight;
        break;
      case 'tool.call': {
        const el = add('tool', '→ ' + ev.name + ' …');
        toolEls.set(ev.callId, el);
        break;
      }
      case 'tool.result': {
        const el = toolEls.get(ev.callId);
        if (el) el.textContent = '✓ ' + ev.name + ' (' + ev.durationMs + 'ms)';
        break;
      }
      case 'tool.error': {
        const el = toolEls.get(ev.callId);
        if (el) { el.textContent = '✗ ' + ev.name + ': ' + ev.error; el.classList.add('error'); }
        break;
      }
      case 'model.call':
        add('tool', '· ' + ev.model + ' — in ' + ev.inputTokens + ' / out ' + ev.outputTokens + ' tok, $' + ev.costUsd.toFixed(4));
        break;
      case 'error':
        add('msg error', ev.message);
        break;
    }
  }
</script>
</body>
</html>`;
  }
}

function randomNonce(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

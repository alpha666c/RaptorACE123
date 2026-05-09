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
    this.panel.webview.html = this.renderHtml(this.aliasList());
    this.panel.onDidDispose(() => this.dispose());
    this.panel.webview.onDidReceiveMessage(this.handleMessage.bind(this));
    this.unsubscribe = host.onEvent((ev) => this.forwardEvent(ev));
  }

  private aliasList(): Array<{ label: string; modelId: string }> {
    // AgentHost.cfg.gateway is private-ish; listing aliases is a harmless read.
    const cfg = (this.host as unknown as {
      cfg: { gateway: { listAliases: () => Array<{ alias: string; modelId: string }> } };
    }).cfg;
    try {
      return cfg.gateway
        .listAliases()
        .map(({ alias, modelId }) => ({ label: `${alias} — ${modelId}`, modelId }));
    } catch {
      return [];
    }
  }

  reveal(): void {
    this.panel.reveal();
  }

  private handleMessage(msg: unknown): void {
    if (!msg || typeof msg !== 'object') return;
    const m = msg as { kind?: string; text?: string; modelId?: string };
    switch (m.kind) {
      case 'user.message':
        if (typeof m.text === 'string') void this.runTurn(m.text);
        break;
      case 'cancel':
        this.currentController?.abort();
        break;
      case 'model.select':
        this.host.setModelOverride(typeof m.modelId === 'string' && m.modelId ? m.modelId : null);
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

  private renderHtml(aliases: Array<{ label: string; modelId: string }>): string {
    const nonce = randomNonce();
    const modelOptions = [
      '<option value="">Auto (router)</option>',
      ...aliases.map(
        (a) => `<option value="${escapeAttr(a.modelId)}">${escapeAttr(a.label)}</option>`,
      ),
    ].join('');
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
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    margin: 0;
    display: flex;
    flex-direction: column;
  }

  /* --- Header --- */
  header {
    padding: 10px 16px;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
    display: flex;
    align-items: center;
    gap: 10px;
  }
  header .dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: #22c55e;
    box-shadow: 0 0 8px rgba(34, 197, 94, 0.5);
  }
  header .title { font-weight: 600; font-size: 13px; letter-spacing: -0.01em; }
  header .spacer { flex: 1; }
  header .sub { color: var(--vscode-descriptionForeground); font-size: 11px; }
  header select.modelPick {
    font: inherit;
    font-size: 11px;
    padding: 3px 6px;
    border-radius: 6px;
    background: var(--vscode-dropdown-background, rgba(255,255,255,0.05));
    color: var(--vscode-dropdown-foreground, var(--vscode-foreground));
    border: 1px solid var(--vscode-dropdown-border, rgba(255,255,255,0.12));
    cursor: pointer;
    max-width: 260px;
  }
  header select.modelPick:hover { border-color: var(--vscode-focusBorder, rgba(255,255,255,0.3)); }

  /* --- Scroll container --- */
  #scroll {
    flex: 1;
    overflow-y: auto;
    scroll-behavior: smooth;
  }
  #scroll::-webkit-scrollbar { width: 8px; }
  #scroll::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background); border-radius: 4px; }
  #scroll::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground); }

  /* --- Message list --- */
  #log {
    max-width: 760px;
    margin: 0 auto;
    padding: 20px 16px 24px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .row { display: flex; width: 100%; }
  .row.user { justify-content: flex-end; }
  .row.assistant { justify-content: flex-start; }

  .bubble {
    max-width: 88%;
    padding: 10px 14px;
    border-radius: 12px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-wrap: break-word;
    word-break: break-word;
  }
  .row.user .bubble {
    background: var(--vscode-textBlockQuote-background, rgba(100, 149, 237, 0.18));
    border: 1px solid var(--vscode-textBlockQuote-border, rgba(100, 149, 237, 0.35));
    border-radius: 12px 12px 2px 12px;
  }
  .row.assistant .bubble {
    background: transparent;
    border: none;
    padding-left: 0;
    padding-right: 0;
    max-width: 100%;
    position: relative;
  }

  /* Collapsible long assistant messages */
  .row.assistant .bubble.collapsible {
    max-height: 280px;
    overflow: hidden;
    mask-image: linear-gradient(to bottom, black 72%, transparent 100%);
    -webkit-mask-image: linear-gradient(to bottom, black 72%, transparent 100%);
  }
  .row.assistant .bubble.expanded {
    max-height: none;
    mask-image: none;
    -webkit-mask-image: none;
  }
  .expand-wrapper {
    max-width: 760px;
    margin: -4px auto 0;
    padding: 0 16px;
    display: flex;
    justify-content: flex-start;
  }
  .expand-btn {
    padding: 4px 12px;
    font-size: 11px;
    font-weight: 500;
    background: transparent;
    color: var(--vscode-textLink-foreground, #4f8cff);
    border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.12));
    border-radius: 6px;
    cursor: pointer;
    transition: background 120ms ease;
  }
  .expand-btn:hover { background: rgba(79, 140, 255, 0.08); }

  /* --- Tool call chips --- */
  .tools {
    max-width: 760px;
    margin: -4px auto 0;
    padding: 0 16px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .tool {
    font-family: var(--vscode-editor-font-family), ui-monospace, monospace;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 0;
  }
  .tool .chev { color: var(--vscode-textLink-foreground, #4f8cff); font-weight: 600; }
  .tool .ok   { color: #22c55e; font-weight: 600; }
  .tool .err  { color: var(--vscode-errorForeground, #f87171); font-weight: 600; }
  .tool .meta { color: var(--vscode-descriptionForeground); font-size: 10px; opacity: 0.8; }
  .tool.errline { color: var(--vscode-errorForeground, #f87171); }

  /* --- Model / cost readout after a turn --- */
  .cost {
    max-width: 760px;
    margin: -2px auto 0;
    padding: 2px 16px 0;
    font-family: var(--vscode-editor-font-family), ui-monospace, monospace;
    font-size: 10.5px;
    color: var(--vscode-descriptionForeground);
    opacity: 0.75;
  }

  /* --- Thinking shimmer --- */
  .thinking {
    max-width: 760px;
    margin: 0 auto;
    padding: 4px 16px;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
    font-style: italic;
    display: flex; align-items: center; gap: 8px;
  }
  .thinking::before {
    content: '';
    width: 14px; height: 14px; border-radius: 50%;
    border: 2px solid var(--vscode-descriptionForeground);
    border-top-color: transparent;
    animation: spin 0.8s linear infinite;
    opacity: 0.6;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* --- Empty state --- */
  #empty {
    max-width: 760px;
    margin: 80px auto 0;
    padding: 0 16px;
    text-align: center;
    color: var(--vscode-descriptionForeground);
  }
  #empty h2 { font-size: 16px; font-weight: 600; margin: 0 0 8px; color: var(--vscode-foreground); }
  #empty p { font-size: 12px; margin: 0; line-height: 1.6; }
  #empty kbd {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 3px;
    border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.12));
    background: rgba(255,255,255,0.05);
    font-family: var(--vscode-editor-font-family), monospace;
    font-size: 11px;
  }

  /* --- Error banner --- */
  .errbanner {
    max-width: 760px;
    margin: 0 auto;
    padding: 10px 14px;
    border-radius: 8px;
    background: rgba(248, 113, 113, 0.1);
    border: 1px solid rgba(248, 113, 113, 0.3);
    color: var(--vscode-errorForeground, #f87171);
    font-size: 12px;
  }

  /* --- Input row --- */
  footer {
    border-top: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.08));
    padding: 12px 16px 14px;
    background: var(--vscode-editor-background);
  }
  #inputrow {
    max-width: 760px;
    margin: 0 auto;
    position: relative;
    display: flex;
    align-items: flex-end;
    gap: 8px;
  }
  textarea {
    flex: 1;
    min-height: 44px;
    max-height: 200px;
    resize: none;
    font: inherit;
    padding: 12px 14px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, rgba(255,255,255,0.12));
    border-radius: 10px;
    outline: none;
    line-height: 1.5;
    transition: border-color 120ms ease;
  }
  textarea:focus {
    border-color: var(--vscode-focusBorder, #4f8cff);
  }

  button {
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    padding: 10px 16px;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: opacity 120ms ease, background 120ms ease;
  }
  button.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  button.primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
  button.secondary {
    background: transparent;
    color: var(--vscode-descriptionForeground);
    border: 1px solid var(--vscode-panel-border, rgba(255,255,255,0.15));
  }
  button.secondary:hover:not(:disabled) { background: rgba(255,255,255,0.05); color: var(--vscode-foreground); }
  button:disabled { opacity: 0.4; cursor: not-allowed; }

  .hint {
    max-width: 760px;
    margin: 6px auto 0;
    font-size: 10.5px;
    color: var(--vscode-descriptionForeground);
    opacity: 0.6;
    text-align: right;
  }
</style>
</head>
<body>
  <header>
    <span class="dot" aria-hidden="true"></span>
    <span class="title">Personal Coding Agent</span>
    <span class="spacer"></span>
    <select id="modelPick" class="modelPick" title="Override the model for the next turn">${modelOptions}</select>
    <span class="sub" id="subtitle">ready</span>
  </header>

  <div id="scroll">
    <div id="empty">
      <h2>What should we build?</h2>
      <p>Ask me to read code, explain something, refactor, run tests, or commit.<br>
      Prefix with <kbd>/council</kbd> to run multi-role review on complex tasks.</p>
    </div>
    <div id="log"></div>
  </div>

  <footer>
    <div id="inputrow">
      <textarea id="input" rows="1" placeholder="Ask the agent…" autofocus></textarea>
      <button id="send" class="primary">Send</button>
      <button id="cancel" class="secondary" disabled>Stop</button>
    </div>
    <div class="hint">⌘+Enter to send · /council for multi-role</div>
  </footer>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const scroll = document.getElementById('scroll');
  const log = document.getElementById('log');
  const empty = document.getElementById('empty');
  const input = document.getElementById('input');
  const sendBtn = document.getElementById('send');
  const cancelBtn = document.getElementById('cancel');
  const subtitle = document.getElementById('subtitle');
  const modelPick = document.getElementById('modelPick');

  const COLLAPSE_THRESHOLD = 1400;

  const stored = vscode.getState() || {};
  if (stored.modelId && modelPick) modelPick.value = stored.modelId;
  if (modelPick) {
    modelPick.addEventListener('change', () => {
      const modelId = modelPick.value;
      vscode.setState({ ...(vscode.getState() || {}), modelId });
      vscode.postMessage({ kind: 'model.select', modelId });
    });
    if (stored.modelId) {
      vscode.postMessage({ kind: 'model.select', modelId: stored.modelId });
    }
  }

  let assistantEl = null;
  let assistantTools = null;
  let thinkingEl = null;
  let toolEls = new Map();

  function hideEmpty() {
    if (empty) empty.style.display = 'none';
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      scroll.scrollTop = scroll.scrollHeight;
    });
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(200, input.scrollHeight) + 'px';
  }
  input.addEventListener('input', autosize);

  function addRow(role, text) {
    hideEmpty();
    const row = document.createElement('div');
    row.className = 'row ' + role;
    const bub = document.createElement('div');
    bub.className = 'bubble';
    bub.textContent = text;
    row.appendChild(bub);
    log.appendChild(row);
    scrollToBottom();
    return bub;
  }

  function addThinking() {
    hideEmpty();
    clearThinking();
    thinkingEl = document.createElement('div');
    thinkingEl.className = 'thinking';
    thinkingEl.textContent = 'thinking';
    log.appendChild(thinkingEl);
    scrollToBottom();
  }

  function clearThinking() {
    if (thinkingEl) { thinkingEl.remove(); thinkingEl = null; }
  }

  function addToolsContainer() {
    const c = document.createElement('div');
    c.className = 'tools';
    log.appendChild(c);
    return c;
  }

  function addToolLine(callId, name) {
    if (!assistantTools) assistantTools = addToolsContainer();
    const row = document.createElement('div');
    row.className = 'tool';
    row.innerHTML = '<span class="chev">→</span><span>' + escapeHtml(name) + '</span><span class="meta">running…</span>';
    assistantTools.appendChild(row);
    toolEls.set(callId, row);
    scrollToBottom();
  }

  function markToolResult(callId, name, durationMs) {
    const el = toolEls.get(callId);
    if (!el) return;
    el.innerHTML = '<span class="ok">✓</span><span>' + escapeHtml(name) + '</span><span class="meta">' + durationMs + 'ms</span>';
  }

  function markToolError(callId, name, error) {
    const el = toolEls.get(callId);
    if (!el) return;
    el.className = 'tool errline';
    el.innerHTML = '<span class="err">✗</span><span>' + escapeHtml(name) + '</span><span class="meta">' + escapeHtml(error.slice(0, 120)) + '</span>';
  }

  function addCostLine(model, inTokens, outTokens, costUsd) {
    const d = document.createElement('div');
    d.className = 'cost';
    d.textContent = model + ' · in ' + inTokens + ' / out ' + outTokens + ' tok · $' + costUsd.toFixed(4);
    log.appendChild(d);
    scrollToBottom();
  }

  function addErrorBanner(msg) {
    const d = document.createElement('div');
    d.className = 'errbanner';
    d.textContent = msg;
    log.appendChild(d);
    scrollToBottom();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function maybeCollapseLast() {
    if (!assistantEl) return;
    const text = assistantEl.textContent || '';
    if (text.length < COLLAPSE_THRESHOLD) return;
    if (assistantEl.dataset.collapsed === 'yes' || assistantEl.dataset.collapsed === 'no') return;
    assistantEl.classList.add('collapsible');
    assistantEl.dataset.collapsed = 'yes';

    const wrapper = document.createElement('div');
    wrapper.className = 'expand-wrapper';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'expand-btn';
    const fmt = (n) => n.toLocaleString();
    btn.textContent = 'Show full response (' + fmt(text.length) + ' chars)';
    btn.addEventListener('click', () => {
      const isCollapsed = assistantEl.dataset.collapsed === 'yes';
      if (isCollapsed) {
        assistantEl.classList.remove('collapsible');
        assistantEl.classList.add('expanded');
        assistantEl.dataset.collapsed = 'no';
        btn.textContent = 'Collapse';
      } else {
        assistantEl.classList.remove('expanded');
        assistantEl.classList.add('collapsible');
        assistantEl.dataset.collapsed = 'yes';
        btn.textContent = 'Show full response (' + fmt(text.length) + ' chars)';
        btn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
    wrapper.appendChild(btn);

    const row = assistantEl.parentElement;
    if (row && row.parentElement) {
      row.parentElement.insertBefore(wrapper, row.nextSibling);
    }
  }

  function send() {
    const t = input.value.trim();
    if (!t) return;
    addRow('user', t);
    input.value = '';
    autosize();
    vscode.postMessage({ kind: 'user.message', text: t });
    sendBtn.disabled = true;
    cancelBtn.disabled = false;
    subtitle.textContent = 'working…';
    assistantEl = null;
    assistantTools = null;
    toolEls = new Map();
    addThinking();
  }

  sendBtn.addEventListener('click', send);
  cancelBtn.addEventListener('click', () => vscode.postMessage({ kind: 'cancel' }));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
  });

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m.kind === 'turn.started') {
      subtitle.textContent = 'working…';
    } else if (m.kind === 'turn.complete') {
      clearThinking();
      maybeCollapseLast();
      sendBtn.disabled = false;
      cancelBtn.disabled = true;
      subtitle.textContent = 'ready';
    } else if (m.kind === 'turn.error') {
      clearThinking();
      addErrorBanner('Error: ' + m.error);
      sendBtn.disabled = false;
      cancelBtn.disabled = true;
      subtitle.textContent = 'error';
    } else if (m.kind === 'agent.event') {
      handleAgentEvent(m.event);
    }
  });

  function handleAgentEvent(ev) {
    switch (ev.kind) {
      case 'message.chunk':
        clearThinking();
        if (!assistantEl) assistantEl = addRow('assistant', '');
        assistantEl.textContent += ev.text;
        scrollToBottom();
        break;
      case 'tool.call':
        addToolLine(ev.callId, ev.name);
        break;
      case 'tool.result':
        markToolResult(ev.callId, ev.name, ev.durationMs);
        break;
      case 'tool.error':
        markToolError(ev.callId, ev.name, ev.error || '');
        break;
      case 'model.call':
        addCostLine(ev.model, ev.inputTokens, ev.outputTokens, ev.costUsd);
        break;
      case 'error':
        addErrorBanner(ev.message);
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

function escapeAttr(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

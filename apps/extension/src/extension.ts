import * as vscode from 'vscode';
import type { BuiltAgent } from './agent-host.js';
import { TIER, tierName, type Tier } from '@agent/shared';
import { buildAgentHost, clearApiKey, getOrPromptApiKey } from './agent-host.js';
import { ChatPanel } from './chat-panel.js';
import { showDiffPreview } from './diff-preview.js';
import { pickTier, VsCodeApprover } from './permissions-ui.js';
import { promptSaveMemory, showMemoryList } from './memory-commands.js';
import { listMcpServers, promptSetMcpSecret } from './mcp-commands.js';
import { invokeSkill, listSkills, toggleSkill } from './skill-commands.js';
import { showServerInfo } from './server-commands.js';

let currentAgent: BuiltAgent | undefined;
let currentChat: ChatPanel | undefined;
let statusItem: vscode.StatusBarItem | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = 'personalAgent.setTier';
  updateStatus(TIER.READ_ONLY);
  statusItem.show();
  context.subscriptions.push(statusItem);

  context.subscriptions.push(
    vscode.commands.registerCommand('personalAgent.openChat', () => openChat(context)),
    vscode.commands.registerCommand('personalAgent.setApiKey', async () => {
      await clearApiKey(context);
      await getOrPromptApiKey(context);
      vscode.window.showInformationMessage('Personal Agent: API key saved to SecretStorage.');
    }),
    vscode.commands.registerCommand('personalAgent.clearApiKey', async () => {
      await clearApiKey(context);
      vscode.window.showInformationMessage('Personal Agent: API key cleared.');
    }),
    vscode.commands.registerCommand('personalAgent.setTier', async () => {
      if (!currentAgent) {
        vscode.window.showInformationMessage('Open the chat first to start a session.');
        return;
      }
      const current = currentAgent.session.getTier();
      const picked = await pickTier(current);
      if (picked !== undefined) {
        currentAgent.session.setTier(picked);
        updateStatus(picked);
        vscode.window.showInformationMessage(`Tier set to ${picked} (${tierName(picked)}).`);
      }
    }),
    vscode.commands.registerCommand('personalAgent.resetSession', async () => {
      currentChat?.dispose();
      await currentAgent?.host.dispose('reset by user');
      await currentAgent?.server?.stop();
      currentAgent?.memory.close();
      currentChat = undefined;
      currentAgent = undefined;
      updateStatus(TIER.READ_ONLY);
      vscode.window.showInformationMessage('Personal Agent: session reset.');
    }),
    vscode.commands.registerCommand('personalAgent.memory.save', async () => {
      const memory = await ensureMemory(context);
      if (memory) await promptSaveMemory(memory);
    }),
    vscode.commands.registerCommand('personalAgent.memory.list', async () => {
      const memory = await ensureMemory(context);
      if (memory) await showMemoryList(memory);
    }),
    vscode.commands.registerCommand('personalAgent.mcp.setSecret', () => promptSetMcpSecret(context)),
    vscode.commands.registerCommand('personalAgent.mcp.list', () => listMcpServers(currentAgent?.mcp)),
    vscode.commands.registerCommand('personalAgent.skills.list', () => listSkills(currentAgent)),
    vscode.commands.registerCommand('personalAgent.skills.toggle', () => toggleSkill(currentAgent)),
    vscode.commands.registerCommand('personalAgent.skills.invoke', () => invokeSkill(currentAgent)),
    vscode.commands.registerCommand('personalAgent.server.info', () => showServerInfo(currentAgent)),
  );
}

async function openChat(context: vscode.ExtensionContext): Promise<void> {
  if (currentAgent && currentChat) {
    currentChat.reveal();
    return;
  }
  const approver = new VsCodeApprover((title, diff) => showDiffPreview(title, diff));
  const built = await buildAgentHost(context, approver);
  if (!built) return;
  currentAgent = built;
  currentChat = new ChatPanel(context, built.host);
  updateStatus(built.session.getTier());
}

async function ensureMemory(context: vscode.ExtensionContext) {
  if (currentAgent) return currentAgent.memory;
  // Memory commands can be invoked without opening the chat — build just enough
  // to get a MemoryStore for the workspace.
  const approver = new VsCodeApprover((title, diff) => showDiffPreview(title, diff));
  const built = await buildAgentHost(context, approver);
  if (!built) return undefined;
  currentAgent = built;
  return built.memory;
}

function updateStatus(tier: Tier): void {
  if (!statusItem) return;
  statusItem.text = `$(shield) Agent · T${tier} ${tierName(tier)}`;
  statusItem.tooltip = 'Click to change permission tier';
}

export async function deactivate(): Promise<void> {
  currentChat?.dispose();
  currentChat = undefined;
  await currentAgent?.host.dispose('extension deactivated');
  await currentAgent?.server?.stop();
  currentAgent?.memory.close();
  currentAgent = undefined;
  statusItem?.dispose();
  statusItem = undefined;
}

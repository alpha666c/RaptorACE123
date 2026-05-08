import * as vscode from 'vscode';
import type { McpSupervisor } from '@agent/mcp';

const SUPPORTED_KEYS = ['CONTEXT7_API_KEY', 'NOTION_TOKEN', 'GITHUB_TOKEN'];

export async function promptSetMcpSecret(context: vscode.ExtensionContext): Promise<void> {
  const keyPicked = await vscode.window.showQuickPick(SUPPORTED_KEYS, {
    title: 'Which MCP secret do you want to set?',
    ignoreFocusOut: true,
  });
  if (!keyPicked) return;

  const value = await vscode.window.showInputBox({
    title: `Set ${keyPicked}`,
    prompt: `Value will be stored in VS Code SecretStorage and passed to MCP servers that declare "${keyPicked}" in envKeys.`,
    password: true,
    ignoreFocusOut: true,
  });
  if (value === undefined) return;
  if (value === '') {
    await context.secrets.delete(`personalAgent.mcp.${keyPicked}`);
    vscode.window.showInformationMessage(`${keyPicked} cleared from SecretStorage.`);
    return;
  }
  await context.secrets.store(`personalAgent.mcp.${keyPicked}`, value);
  vscode.window.showInformationMessage(
    `${keyPicked} saved. Reopen the agent (Reset Session → Open Chat) for MCP servers to pick it up.`,
  );
}

export async function listMcpServers(mcp: McpSupervisor | undefined): Promise<void> {
  if (!mcp) {
    vscode.window.showInformationMessage('Open the chat first to start the MCP supervisor.');
    return;
  }
  const tools = mcp.allTools();
  if (tools.length === 0) {
    vscode.window.showInformationMessage(
      'No MCP servers running. Add entries to mcp.config.json at the workspace root.',
    );
    return;
  }
  const grouped = new Map<string, string[]>();
  for (const { server, tool } of tools) {
    const list = grouped.get(server.name) ?? [];
    list.push(tool.name);
    grouped.set(server.name, list);
  }
  const items = [...grouped.entries()].map(([name, toolNames]) => ({
    label: name,
    description: `${toolNames.length} tool${toolNames.length === 1 ? '' : 's'}`,
    detail: toolNames.slice(0, 6).join(', ') + (toolNames.length > 6 ? ', …' : ''),
  }));
  await vscode.window.showQuickPick(items, { title: 'Running MCP servers' });
}

import * as vscode from 'vscode';
import type { BuiltAgent } from './agent-host.js';

export async function showServerInfo(agent: BuiltAgent | undefined): Promise<void> {
  if (!agent?.server || !agent.serverToken) {
    vscode.window.showInformationMessage(
      'Web server is not running. Open the agent chat first (it starts alongside).',
    );
    return;
  }
  const url = agent.server.url;
  const token = agent.serverToken;

  const picked = await vscode.window.showQuickPick(
    [
      { label: 'Copy URL', action: 'url' as const },
      { label: 'Copy token', action: 'token' as const },
      { label: 'Copy URL + token as one string', action: 'combined' as const },
    ],
    {
      title: `Agent web server — ${url}`,
      placeHolder: 'Copy something to paste into the web app',
    },
  );
  if (!picked) return;

  switch (picked.action) {
    case 'url':
      await vscode.env.clipboard.writeText(url);
      vscode.window.showInformationMessage('URL copied.');
      break;
    case 'token':
      await vscode.env.clipboard.writeText(token);
      vscode.window.showInformationMessage('Token copied — treat like a password.');
      break;
    case 'combined':
      await vscode.env.clipboard.writeText(`${url}#token=${token}`);
      vscode.window.showInformationMessage('URL#token copied.');
      break;
  }
}

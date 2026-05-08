import * as vscode from 'vscode';

/**
 * Derive the agent's allowed project roots from the VS Code workspace folders.
 * Throws if no workspace is open — the agent refuses to run without a workspace.
 */
export function getWorkspaceRoots(): string[] {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    throw new Error('No workspace folder open. Open a project folder before starting the agent.');
  }
  return folders.map((f) => f.uri.fsPath);
}

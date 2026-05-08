import * as vscode from 'vscode';
import type { BuiltAgent } from './agent-host.js';

export async function listSkills(agent: BuiltAgent | undefined): Promise<void> {
  if (!agent) {
    vscode.window.showInformationMessage('Open the chat first to load skills.');
    return;
  }
  const skills = agent.skills.list();
  const items = skills.map((s) => ({
    label: `${agent.skills.isEnabled(s.manifest.name) ? '● ' : '○ '}${s.manifest.name}`,
    description: s.manifest.description,
    detail: s.manifest.triggers.map((t) => t.type).join(', ') || 'no triggers',
  }));
  await vscode.window.showQuickPick(items, {
    title: `Skills loaded (${skills.length})`,
    placeHolder: 'View-only list of registered skills',
  });
}

export async function toggleSkill(agent: BuiltAgent | undefined): Promise<void> {
  if (!agent) {
    vscode.window.showInformationMessage('Open the chat first to load skills.');
    return;
  }
  const skills = agent.skills.list();
  const picked = await vscode.window.showQuickPick(
    skills.map((s) => ({
      label: `${agent.skills.isEnabled(s.manifest.name) ? '● ' : '○ '}${s.manifest.name}`,
      description: s.manifest.description,
      name: s.manifest.name,
    })),
    { title: 'Enable / disable skill (toggles)' },
  );
  if (!picked) return;
  const currentlyEnabled = agent.skills.isEnabled(picked.name);
  agent.skills.setEnabled(picked.name, !currentlyEnabled);
  vscode.window.showInformationMessage(
    `Skill ${picked.name} ${!currentlyEnabled ? 'enabled' : 'disabled'}.`,
  );
}

export async function invokeSkill(agent: BuiltAgent | undefined): Promise<void> {
  if (!agent) {
    vscode.window.showInformationMessage('Open the chat first to load skills.');
    return;
  }
  const invocable = agent.skills.enabled().filter((s) => typeof s.invoke === 'function');
  if (invocable.length === 0) {
    vscode.window.showInformationMessage('No invocable skills enabled.');
    return;
  }
  const picked = await vscode.window.showQuickPick(
    invocable.map((s) => ({ label: s.manifest.name, description: s.manifest.description, skill: s })),
    { title: 'Invoke a skill' },
  );
  if (!picked) return;
  const message = await vscode.window.showInputBox({
    title: `Invoke ${picked.skill.manifest.name}`,
    prompt: 'Your request (passed to the skill as input.message)',
    ignoreFocusOut: true,
  });
  if (!message) return;

  const output = vscode.window.createOutputChannel(`Agent skill: ${picked.skill.manifest.name}`);
  output.show(true);
  output.appendLine(`Invoking ${picked.skill.manifest.name}…`);
  try {
    const result = await picked.skill.invoke?.(buildAdHocSkillContext(agent), { message });
    const text = typeof (result as { text?: unknown })?.text === 'string' ? (result as { text: string }).text : JSON.stringify(result, null, 2);
    output.appendLine('');
    output.appendLine(text);
  } catch (e) {
    output.appendLine(`Error: ${(e as Error).message}`);
  }
}

function buildAdHocSkillContext(agent: BuiltAgent): import('@agent/skills').SkillContext {
  return {
    sessionId: 'adhoc',
    projectRoots: [],
    registry: agent.registry,
    memory: agent.memory,
    gateway: (agent.host as unknown as { cfg: { gateway: import('@agent/model-gateway').ModelGateway } }).cfg.gateway,
    currentTier: agent.session.getTier(),
    toolContext: {
      sessionId: 'adhoc',
      projectRoots: [],
      signal: new AbortController().signal,
    },
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  };
}

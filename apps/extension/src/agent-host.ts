import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as vscode from 'vscode';
import { AgentHost } from '@agent/core';
import {
  DEFAULT_MCP_CONFIG,
  McpSupervisor,
  loadMcpConfig,
  registerMcpTools,
  type McpConfig,
} from '@agent/mcp';
import { MemoryStore } from '@agent/memory';
import { DEFAULT_MODEL_CONFIG, ModelGateway, loadModelConfig } from '@agent/model-gateway';
import { SessionPermissionStore, type Approver } from '@agent/permissions';
import {
  SkillRegistry,
  buildBuiltInSkillRegistry,
  discoverUserSkills,
  loadUserSkill,
} from '@agent/skills';
import { buildBuiltInRegistry, type ToolRegistry } from '@agent/tools';
import { TIER } from '@agent/shared';
import { getWorkspaceRoots } from './workspace-scope.js';

const SECRET_KEY = 'personalAgent.openrouterApiKey';

/**
 * Env var names that MCP servers may need, fetched from VS Code SecretStorage
 * if declared in their `envKeys`. Add new keys here as you add MCP servers.
 */
const MCP_SECRET_KEYS = ['CONTEXT7_API_KEY', 'NOTION_TOKEN', 'GITHUB_TOKEN'] as const;

export interface BuiltAgent {
  host: AgentHost;
  memory: MemoryStore;
  session: SessionPermissionStore;
  registry: ToolRegistry;
  mcp: McpSupervisor;
  skills: SkillRegistry;
}

export async function getOrPromptApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
  const existing = await context.secrets.get(SECRET_KEY);
  if (existing) return existing;
  const entered = await vscode.window.showInputBox({
    title: 'OpenRouter API key',
    prompt: 'Paste your OpenRouter API key. It will be stored in VS Code SecretStorage (OS keychain).',
    password: true,
    ignoreFocusOut: true,
  });
  if (!entered) return undefined;
  await context.secrets.store(SECRET_KEY, entered);
  return entered;
}

export async function clearApiKey(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(SECRET_KEY);
}

export async function buildAgentHost(
  context: vscode.ExtensionContext,
  approver: Approver,
): Promise<BuiltAgent | undefined> {
  const apiKey = await getOrPromptApiKey(context);
  if (!apiKey) {
    vscode.window.showWarningMessage('Personal Agent: no API key set. Run "Set OpenRouter API Key" to continue.');
    return undefined;
  }

  const roots = getWorkspaceRoots();
  const modelsPath = await resolveModelsConfigPath(roots);
  const config = modelsPath ? await safeLoadConfig(modelsPath) : DEFAULT_MODEL_CONFIG;

  const gateway = new ModelGateway({ apiKey, config });
  const registry: ToolRegistry = buildBuiltInRegistry();
  const session = new SessionPermissionStore(TIER.READ_ONLY);

  const memory = await MemoryStore.create(roots[0] ?? process.cwd(), {
    sqlJsWasmPath: resolveSqlJsWasmPath(),
  });

  // Start MCP supervisor, register its tools into the shared registry.
  // Failures on individual servers don't block startup — the supervisor
  // just skips them and logs. Agent continues with built-in tools + whatever
  // MCP servers came up successfully.
  const mcpConfig = await resolveMcpConfig(roots);
  const mcpSecrets = await collectMcpSecrets(context);
  const mcp = new McpSupervisor({ config: mcpConfig, secrets: mcpSecrets });
  await mcp.start();
  registerMcpTools(registry, mcp);

  // Skills: built-ins + any user-authored skills at <workspace>/.agent/skills/*.
  const skills = buildBuiltInSkillRegistry();
  await loadUserAuthoredSkills(skills, roots);
  skills.registerToolsInto(registry);

  const taskType = vscode.workspace.getConfiguration('personalAgent').get<string>('defaultTaskType') ?? 'implement';
  const maxSteps = vscode.workspace.getConfiguration('personalAgent').get<number>('maxSteps') ?? 8;

  const host = new AgentHost({
    projectRoots: roots,
    registry,
    gateway,
    session,
    approver,
    memory,
    mcp,
    skills,
    taskType,
    maxSteps,
  });

  return { host, memory, session, registry, mcp, skills };
}

async function loadUserAuthoredSkills(
  registry: SkillRegistry,
  roots: readonly string[],
): Promise<void> {
  for (const root of roots) {
    const dir = path.join(root, '.agent', 'skills');
    const discovered = discoverUserSkills(dir);
    for (const d of discovered) {
      const skill = await loadUserSkill(d);
      if (skill && !registry.get(skill.manifest.name)) {
        registry.register(skill);
      }
    }
  }
}

async function resolveMcpConfig(roots: readonly string[]): Promise<McpConfig> {
  const configured = vscode.workspace.getConfiguration('personalAgent').get<string>('mcpConfigPath');
  const candidates: string[] = [];
  if (configured) candidates.push(configured);
  for (const root of roots) candidates.push(path.join(root, 'mcp.config.json'));

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return await loadMcpConfig(candidate);
    } catch {
      // try next
    }
  }
  return DEFAULT_MCP_CONFIG;
}

async function collectMcpSecrets(
  context: vscode.ExtensionContext,
): Promise<Record<string, string | undefined>> {
  const out: Record<string, string | undefined> = {};
  for (const key of MCP_SECRET_KEYS) {
    const value = await context.secrets.get(`personalAgent.mcp.${key}`);
    if (value) out[key] = value;
  }
  return out;
}

async function resolveModelsConfigPath(roots: readonly string[]): Promise<string | undefined> {
  const configured = vscode.workspace.getConfiguration('personalAgent').get<string>('modelsConfigPath');
  if (configured && configured.length > 0) return configured;
  for (const root of roots) {
    const candidate = path.join(root, 'models.config.json');
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  return undefined;
}

function resolveSqlJsWasmPath(): string {
  const req = createRequire(pathToFileURL(__filename));
  return path.join(path.dirname(req.resolve('sql.js')), 'sql-wasm.wasm');
}

async function safeLoadConfig(
  p: string,
): Promise<ReturnType<typeof loadModelConfig> extends Promise<infer T> ? T : never> {
  try {
    return await loadModelConfig(p);
  } catch (e) {
    vscode.window.showWarningMessage(`Could not load ${p}: ${(e as Error).message}. Using defaults.`);
    return DEFAULT_MODEL_CONFIG;
  }
}

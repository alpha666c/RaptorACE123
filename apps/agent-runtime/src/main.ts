import { createRequire } from 'node:module';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { AgentHost } from '@agent/core';
import {
  DEFAULT_MCP_CONFIG,
  McpSupervisor,
  loadMcpConfig,
  registerMcpTools,
} from '@agent/mcp';
import { MemoryStore } from '@agent/memory';
import { DEFAULT_MODEL_CONFIG, ModelGateway, loadModelConfig } from '@agent/model-gateway';
import { SessionPermissionStore } from '@agent/permissions';
import { RemoteApprover, generateToken, startServer, type ServerState } from '@agent/server';
import { buildBuiltInSkillRegistry } from '@agent/skills';
import type { AgentEvent } from '@agent/shared';
import { TIER, getLogger } from '@agent/shared';
import { buildBuiltInRegistry } from '@agent/tools';

const log = getLogger('agent-runtime');

/**
 * Standalone entry point. Spins up the full agent on a server box, exposes it
 * via the @agent/server HTTP surface with a RemoteApprover routing permission
 * prompts to the web UI. Configuration comes from env vars only.
 */
async function main(): Promise<void> {
  const workspaceRoot = process.env['AGENT_WORKSPACE'];
  if (!workspaceRoot) {
    throw new Error('AGENT_WORKSPACE env var is required (absolute path to the repo the agent operates on)');
  }
  if (!fs.existsSync(workspaceRoot)) {
    throw new Error(`AGENT_WORKSPACE does not exist: ${workspaceRoot}`);
  }

  const apiKey = process.env['OPENROUTER_API_KEY'];
  if (!apiKey) throw new Error('OPENROUTER_API_KEY env var is required');

  const roots = [workspaceRoot];
  const modelsConfigPath = process.env['AGENT_MODELS_CONFIG'] ?? path.join(workspaceRoot, 'models.config.json');
  const mcpConfigPath = process.env['AGENT_MCP_CONFIG'] ?? path.join(workspaceRoot, 'mcp.config.json');

  const modelConfig = fs.existsSync(modelsConfigPath) ? await loadModelConfig(modelsConfigPath) : DEFAULT_MODEL_CONFIG;
  const mcpConfig = fs.existsSync(mcpConfigPath) ? await loadMcpConfig(mcpConfigPath) : DEFAULT_MCP_CONFIG;

  const req = createRequire(pathToFileURL(import.meta.url).href);
  const sqlJsWasmPath = path.join(path.dirname(req.resolve('sql.js')), 'sql-wasm.wasm');

  const gateway = new ModelGateway({ apiKey, config: modelConfig });
  const registry = buildBuiltInRegistry();
  const session = new SessionPermissionStore(TIER.READ_ONLY);
  const memory = await MemoryStore.create(workspaceRoot, { sqlJsWasmPath });

  const mcpSecrets: Record<string, string | undefined> = {};
  for (const server of mcpConfig.servers) {
    for (const key of server.envKeys) mcpSecrets[key] = process.env[key];
  }
  const mcp = new McpSupervisor({ config: mcpConfig, secrets: mcpSecrets });
  await mcp.start();
  registerMcpTools(registry, mcp);

  const skills = buildBuiltInSkillRegistry();
  skills.registerToolsInto(registry);

  const token = process.env['AGENT_SERVER_TOKEN'] ?? generateToken();
  const eventListeners = new Set<(ev: AgentEvent) => void>();
  const pendingApprovals = new Map<string, (decision: unknown) => void>();

  const broadcast = (ev: AgentEvent): void => {
    for (const l of eventListeners) {
      try {
        l(ev);
      } catch {
        // swallow — never let a listener crash the agent
      }
    }
  };

  const state: ServerState = {
    token,
    memory,
    session,
    registry,
    gateway,
    mcp,
    skills,
    subscribeEvents: (listener: (ev: AgentEvent) => void): (() => void) => {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },
    pendingApprovals,
  };

  const approver = new RemoteApprover(state, {
    timeoutMs: Number(process.env['AGENT_APPROVAL_TIMEOUT_MS'] ?? '120000'),
    broadcastEvent: (requestId: string, request): void => {
      broadcast({
        kind: 'permission.request',
        sessionId: 'standalone',
        requestId,
        tool: request.tool,
        args: request.args,
        requiredTier: request.requiredTier,
        currentTier: request.currentTier,
        reason: request.reason,
      });
    },
  });

  const host = new AgentHost({
    projectRoots: roots,
    registry,
    gateway,
    session,
    approver,
    memory,
    mcp,
    skills,
    taskType: process.env['AGENT_TASK_TYPE'] ?? 'implement',
    maxSteps: Number(process.env['AGENT_MAX_STEPS'] ?? '8'),
    councilMode: (process.env['AGENT_COUNCIL_MODE'] as 'off' | 'auto' | 'force' | undefined) ?? 'auto',
    maxCostPerTurnUsd: Number(process.env['AGENT_MAX_COST_PER_TURN_USD'] ?? '2'),
    contextTokenBudget: Number(process.env['AGENT_CONTEXT_BUDGET'] ?? '180000'),
  });

  host.onEvent(broadcast);

  const server = await startServer({
    state,
    port: Number(process.env['AGENT_SERVER_PORT'] ?? '23456'),
    hostname: process.env['AGENT_SERVER_HOST'] ?? '0.0.0.0',
    async runTurn(message: string, signal: AbortSignal): Promise<{ text: string }> {
      const result = await host.run({ userMessage: message, signal });
      return { text: result.finalText };
    },
  });

  log.info({ url: server.url, workspaceRoot }, 'agent-runtime.started');
  // eslint-disable-next-line no-console
  console.log(`Personal Coding Agent runtime listening on ${server.url}`);
  // eslint-disable-next-line no-console
  console.log(`Bearer token: ${token}`);

  const shutdown = async (sig: string): Promise<void> => {
    log.info({ sig }, 'agent-runtime.shutdown');
    try {
      await host.dispose('process exit');
    } catch {
      /* ignore */
    }
    try {
      await server.stop();
    } catch {
      /* ignore */
    }
    memory.close();
    process.exit(0);
  };
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal:', err);
  process.exit(1);
});

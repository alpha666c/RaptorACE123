import type { McpSupervisor } from '@agent/mcp';
import type { MemoryStore } from '@agent/memory';
import type { ModelGateway } from '@agent/model-gateway';
import type { SessionPermissionStore } from '@agent/permissions';
import type { SkillRegistry } from '@agent/skills';
import type { ToolRegistry } from '@agent/tools';
import type { AgentEvent } from '@agent/shared';

/**
 * The server reads from (and writes to) the live agent state. The extension
 * passes this snapshot in when it starts the server. Some fields are optional
 * because the agent may not yet be open (no chat session started).
 */
export interface ServerDeps {
  token: string;
  memory: MemoryStore;
  session: SessionPermissionStore;
  registry: ToolRegistry;
  gateway: ModelGateway;
  mcp: McpSupervisor;
  skills: SkillRegistry;
  /**
   * Subscribe to agent events. The server rebroadcasts these over SSE to any
   * connected web clients. Returns an unsubscribe function.
   */
  subscribeEvents(listener: (ev: AgentEvent) => void): () => void;
  /**
   * A pending approval that was forwarded here (no approver in the extension
   * or user explicitly routed it to the web app). When a decision comes in
   * via POST /api/permissions/decide, the server resolves the associated
   * promise. Null when no request is pending.
   */
  pendingApprovals: Map<string, (decision: unknown) => void>;
}

export type ServerState = ServerDeps;

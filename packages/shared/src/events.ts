import type { Tier } from './tier.js';

export type AgentEvent =
  | { kind: 'agent.started'; sessionId: string; timestamp: number }
  | { kind: 'agent.stopped'; sessionId: string; timestamp: number; reason: 'done' | 'error' | 'cancelled' }
  | { kind: 'message.chunk'; sessionId: string; text: string }
  | { kind: 'message.complete'; sessionId: string; text: string }
  | { kind: 'tool.call'; sessionId: string; callId: string; name: string; args: unknown }
  | { kind: 'tool.result'; sessionId: string; callId: string; name: string; result: unknown; durationMs: number }
  | { kind: 'tool.error'; sessionId: string; callId: string; name: string; error: string }
  | { kind: 'permission.request'; sessionId: string; requestId: string; tool: string; args: unknown; requiredTier: Tier; currentTier: Tier; reason: string }
  | { kind: 'permission.decided'; sessionId: string; requestId: string; decision: PermissionDecision }
  | { kind: 'tier.changed'; sessionId: string; from: Tier; to: Tier }
  | { kind: 'model.call'; sessionId: string; taskType: string; model: string; inputTokens: number; outputTokens: number; costUsd: number }
  | { kind: 'error'; sessionId: string; message: string; details?: unknown };

export type PermissionDecision =
  | { action: 'allow-once' }
  | { action: 'allow-session' }
  | { action: 'upgrade-tier'; toTier: Tier }
  | { action: 'deny' };

export type EventListener = (event: AgentEvent) => void;

import type { PermissionDecision, Tier } from '@agent/shared';
import { TIER, tierName } from '@agent/shared';
import type { Approver, ApprovalRequest } from './approver.js';
import type { SessionPermissionStore } from './session-store.js';

export type PolicyDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'requires-approval'; reason: string };

export interface PolicyContext {
  sessionId: string;
  session: SessionPermissionStore;
}

export interface PolicyInput {
  toolName: string;
  requiredTier: Tier;
  args: unknown;
  preview?: ApprovalRequest['preview'];
}

/**
 * Static pre-approval check — does NOT contact the approver.
 * Returns one of:
 *   - allow: proceed immediately
 *   - deny: block, provide reason
 *   - requires-approval: caller must invoke the Approver
 */
export function evaluatePolicy(input: PolicyInput, ctx: PolicyContext): PolicyDecision {
  const current = ctx.session.getTier();

  // Kill switch: AGENT_READ_ONLY=1 forces tier 0, no approval can bypass.
  if (process.env['AGENT_READ_ONLY'] === '1' && input.requiredTier > TIER.READ_ONLY) {
    return { kind: 'deny', reason: 'AGENT_READ_ONLY=1 is set; only read-only tools may run.' };
  }

  if (ctx.session.isToolAllowedForSession(input.toolName)) {
    return { kind: 'allow' };
  }

  if (input.requiredTier <= current) return { kind: 'allow' };

  return {
    kind: 'requires-approval',
    reason: `Tool ${input.toolName} requires tier ${input.requiredTier} (${tierName(input.requiredTier)}); current tier is ${current} (${tierName(current)}).`,
  };
}

/**
 * Full gate: evaluate, and if approval is needed, consult the approver.
 * Applies the user's decision (allow-once, allow-session, upgrade-tier, deny).
 * Returns final allow/deny.
 */
export async function gateToolCall(
  input: PolicyInput,
  ctx: PolicyContext,
  approver: Approver,
): Promise<{ allowed: boolean; reason?: string; decision?: PermissionDecision }> {
  const decision = evaluatePolicy(input, ctx);

  if (decision.kind === 'allow') return { allowed: true };
  if (decision.kind === 'deny') return { allowed: false, reason: decision.reason };

  const req: ApprovalRequest = {
    sessionId: ctx.sessionId,
    tool: input.toolName,
    args: input.args,
    requiredTier: input.requiredTier,
    currentTier: ctx.session.getTier(),
    reason: decision.reason,
    ...(input.preview ? { preview: input.preview } : {}),
  };
  const userDecision = await approver.requestApproval(req);

  switch (userDecision.action) {
    case 'allow-once':
      return { allowed: true, decision: userDecision };
    case 'allow-session':
      ctx.session.allowToolForSession(input.toolName);
      return { allowed: true, decision: userDecision };
    case 'upgrade-tier':
      ctx.session.setTier(userDecision.toTier);
      return { allowed: true, decision: userDecision };
    case 'deny':
      return { allowed: false, reason: 'User denied the request.', decision: userDecision };
  }
}

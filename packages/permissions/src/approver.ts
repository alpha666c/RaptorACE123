import type { PermissionDecision, Tier } from '@agent/shared';

export interface ApprovalRequest {
  sessionId: string;
  tool: string;
  args: unknown;
  requiredTier: Tier;
  currentTier: Tier;
  reason: string;
  /** Optional preview content (e.g., a file diff) the UI may render. */
  preview?: { kind: 'diff' | 'text'; content: string };
}

export interface Approver {
  requestApproval(req: ApprovalRequest): Promise<PermissionDecision>;
}

/** In-memory approver that auto-denies. Useful for tests and read-only boot. */
export class DenyAllApprover implements Approver {
  async requestApproval(_req: ApprovalRequest): Promise<PermissionDecision> {
    return { action: 'deny' };
  }
}

/** In-memory approver that auto-allows. FOR TESTS ONLY. */
export class AllowAllApprover implements Approver {
  async requestApproval(_req: ApprovalRequest): Promise<PermissionDecision> {
    return { action: 'allow-once' };
  }
}

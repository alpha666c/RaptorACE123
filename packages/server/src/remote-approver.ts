import type { Approver, ApprovalRequest } from '@agent/permissions';
import type { PermissionDecision } from '@agent/shared';
import { newId, getLogger } from '@agent/shared';
import type { ServerState } from './types.js';

const log = getLogger('remote-approver');

export interface RemoteApproverOptions {
  /** How long to wait for a decision before denying. Default 2 minutes. */
  timeoutMs?: number;
  /** Broadcast `permission.request` events so the web UI sees pending approvals. */
  broadcastEvent?: (requestId: string, req: ApprovalRequest) => void;
}

/**
 * An Approver that routes requests to the web UI via the server's pending-
 * approvals map. When a request comes in, it's enqueued with a freshly-generated
 * id; the web UI calls POST /api/permissions/decide with that id, which
 * resolves the promise. Times out to 'deny' after `timeoutMs` — never hangs
 * forever.
 */
export class RemoteApprover implements Approver {
  constructor(
    private readonly state: ServerState,
    private readonly opts: RemoteApproverOptions = {},
  ) {}

  async requestApproval(req: ApprovalRequest): Promise<PermissionDecision> {
    const requestId = newId('approval');
    const timeoutMs = this.opts.timeoutMs ?? 120_000;

    const decision = await new Promise<PermissionDecision>((resolve) => {
      const timer = setTimeout(() => {
        log.warn({ requestId, tool: req.tool, timeoutMs }, 'remote-approver.timed.out');
        this.state.pendingApprovals.delete(requestId);
        resolve({ action: 'deny' });
      }, timeoutMs);

      this.state.pendingApprovals.set(requestId, (raw: unknown) => {
        clearTimeout(timer);
        const value = raw as PermissionDecision;
        resolve(value);
      });
      try {
        this.opts.broadcastEvent?.(requestId, req);
      } catch (e) {
        log.warn({ err: (e as Error).message }, 'remote-approver.broadcast.failed');
      }
    });

    return decision;
  }
}

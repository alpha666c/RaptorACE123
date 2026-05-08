import * as vscode from 'vscode';
import type { PermissionDecision, Tier } from '@agent/shared';
import { TIER, tierName } from '@agent/shared';
import type { Approver, ApprovalRequest } from '@agent/permissions';

export class VsCodeApprover implements Approver {
  constructor(private diffPreviewer?: (title: string, content: string) => Promise<void>) {}

  async requestApproval(req: ApprovalRequest): Promise<PermissionDecision> {
    if (req.preview?.kind === 'diff' && this.diffPreviewer) {
      await this.diffPreviewer(`${req.tool} — ${req.reason}`, req.preview.content);
    }

    const labels = {
      once: '✓ Allow once',
      session: '✓ Allow this tool for the rest of this session',
      upgrade: `↑ Raise tier to ${req.requiredTier} (${tierName(req.requiredTier)})`,
      deny: '✗ Deny',
    };

    const picked = await vscode.window.showQuickPick(
      [
        { label: labels.once, value: 'once' },
        { label: labels.session, value: 'session' },
        { label: labels.upgrade, value: 'upgrade' },
        { label: labels.deny, value: 'deny' },
      ],
      {
        placeHolder: `${req.tool} (tier ${req.requiredTier}) — ${truncate(req.reason, 120)}`,
        ignoreFocusOut: true,
      },
    );

    if (!picked) return { action: 'deny' };
    switch (picked.value) {
      case 'once':
        return { action: 'allow-once' };
      case 'session':
        return { action: 'allow-session' };
      case 'upgrade':
        return { action: 'upgrade-tier', toTier: req.requiredTier };
      case 'deny':
      default:
        return { action: 'deny' };
    }
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export async function pickTier(current: Tier): Promise<Tier | undefined> {
  const items = Object.values(TIER)
    .filter((t): t is Tier => typeof t === 'number')
    .map((t) => ({
      label: `${t === current ? '● ' : '   '}Tier ${t} — ${tierName(t)}`,
      value: t,
    }));
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: `Current tier: ${current} (${tierName(current)}). Choose a new tier.`,
  });
  return picked?.value;
}

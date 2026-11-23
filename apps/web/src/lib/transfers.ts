/** One step of a workspace transfer as the audit log keeps it, ready for the page. */
export interface TransferStep {
  id: string;
  action: string;
  actorName: string | null;
  data: Record<string, string | number | boolean | null>;
  /** ISO time. */
  createdAt: string;
}

const text = (value: unknown) => (typeof value === 'string' && value ? value : null);

/** The sentence for one step of the history, naming who did what. */
export function describeTransferStep(step: TransferStep): string {
  const who = step.actorName ?? 'Someone';
  switch (step.action) {
    case 'workspace.transfer_started': {
      const to = text(step.data.toEmail) ?? 'another person';
      const stays = step.data.previousOwnerStays !== false;
      return `${who} offered the workspace to ${to}${stays ? ', staying on as an admin' : ', leaving it afterwards'}.`;
    }
    case 'workspace.transfer_accepted': {
      const changed = Number(step.data.billingAdminsChanged ?? 0);
      const billing =
        changed > 0
          ? ` ${changed === 1 ? 'One billing admin became a member' : `${changed} billing admins became members`}.`
          : '';
      const previous =
        step.data.previousOwner === 'left'
          ? 'The previous owner left.'
          : 'The previous owner is now an admin.';
      return `${who} accepted, and the workspace moved to their account. ${previous}${billing}`;
    }
    case 'workspace.transfer_declined':
      return `${who} declined the transfer. Nothing changed.`;
    case 'workspace.transfer_cancelled':
      return `${who} cancelled the transfer. Nothing changed.`;
    case 'workspace.transfer_expired':
      return 'The offer expired after 7 days without an answer. Nothing changed.';
    default:
      return `${who}: ${step.action}`;
  }
}

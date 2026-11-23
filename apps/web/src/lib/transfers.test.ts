import { describe, expect, it } from 'vitest';
import { describeTransferStep, type TransferStep } from './transfers';

const step = (
  action: string,
  data: TransferStep['data'] = {},
  actorName: string | null = 'Asha',
) => ({
  id: 'aud_1',
  action,
  actorName,
  data,
  createdAt: '2026-11-23T10:00:00.000Z',
});

describe('describeTransferStep', () => {
  it('says who offered the workspace to whom, and what happens to them', () => {
    expect(
      describeTransferStep(
        step('workspace.transfer_started', {
          toEmail: 'ravi@example.com',
          previousOwnerStays: true,
        }),
      ),
    ).toBe('Asha offered the workspace to ravi@example.com, staying on as an admin.');
    expect(
      describeTransferStep(
        step('workspace.transfer_started', {
          toEmail: 'ravi@example.com',
          previousOwnerStays: false,
        }),
      ),
    ).toBe('Asha offered the workspace to ravi@example.com, leaving it afterwards.');
  });

  it('spells out what changed when the transfer completed', () => {
    expect(
      describeTransferStep(
        step(
          'workspace.transfer_accepted',
          { previousOwner: 'admin', billingAdminsChanged: 2 },
          'Ravi',
        ),
      ),
    ).toBe(
      'Ravi accepted, and the workspace moved to their account. The previous owner is now an admin. 2 billing admins became members.',
    );
    expect(
      describeTransferStep(
        step(
          'workspace.transfer_accepted',
          { previousOwner: 'left', billingAdminsChanged: 0 },
          'Ravi',
        ),
      ),
    ).toBe('Ravi accepted, and the workspace moved to their account. The previous owner left.');
  });

  it('marks the endings where nothing changed', () => {
    expect(describeTransferStep(step('workspace.transfer_declined', {}, 'Ravi'))).toContain(
      'declined',
    );
    expect(describeTransferStep(step('workspace.transfer_cancelled'))).toContain('cancelled');
    expect(describeTransferStep(step('workspace.transfer_expired', {}, null))).toBe(
      'The offer expired after 7 days without an answer. Nothing changed.',
    );
  });
});

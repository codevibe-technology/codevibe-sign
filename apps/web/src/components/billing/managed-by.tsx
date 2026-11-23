import { Card, CardBody } from '@/components/ui/card';

/**
 * Shown to an admin of a workspace who does not own the account it is on: the plan, the
 * payments and the eSign set-up belong to the account, so its owner changes them.
 */
export function ManagedBy({
  owner,
  what,
  hidden = false,
}: {
  owner: string | null;
  /** What the account holds, as a clause: "billing details are kept once". */
  what: string;
  /** The page shows this person nothing else. */
  hidden?: boolean;
}) {
  return (
    <Card data-testid="managed-by">
      <CardBody>
        <p className="text-sm">
          <span className="font-semibold">
            {owner ? `Managed by ${owner}.` : 'Managed by the account owner.'}
          </span>{' '}
          This workspace is on {owner ? 'their' : 'the owner’s'} account, so {what} for every
          workspace on it.{' '}
          {hidden
            ? 'Only the account owner can see and change it.'
            : 'You can see it here; only the account owner can change it.'}
        </p>
      </CardBody>
    </Card>
  );
}

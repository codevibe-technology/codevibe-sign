import { Ban, CheckCircle2, Clock, Link2Off, XCircle } from 'lucide-react';
import { endStateCopy, type EndState } from '@/lib/signing';
import { SigningMessage } from './signing-shell';

const ICONS: Record<EndState, { icon: typeof Clock; tone: 'neutral' | 'success' | 'warning' }> = {
  invalid: { icon: Link2Off, tone: 'warning' },
  expired: { icon: Clock, tone: 'warning' },
  voided: { icon: Ban, tone: 'neutral' },
  declined: { icon: XCircle, tone: 'neutral' },
  completed: { icon: CheckCircle2, tone: 'success' },
  signed: { icon: CheckCircle2, tone: 'success' },
  not_your_turn: { icon: Clock, tone: 'neutral' },
  declined_by_you: { icon: XCircle, tone: 'neutral' },
};

/** Why there is nothing to sign here, and what to do instead. */
export function EndStateMessage({ state, company }: { state: EndState; company: string | null }) {
  const { title, body } = endStateCopy(state, company);
  const { icon: Icon, tone } = ICONS[state];
  return (
    <SigningMessage icon={<Icon aria-hidden className="h-6 w-6" />} title={title} tone={tone}>
      <p>{body}</p>
    </SigningMessage>
  );
}

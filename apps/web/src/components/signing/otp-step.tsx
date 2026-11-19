'use client';

import { KeyRound, MessageSquareOff } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { otpProblem, signFetch, type SignerView } from '@/lib/signing';
import { SigningMessage } from './signing-shell';

/** Checks it is really the recipient: a six-digit code by email, or by SMS when set up. */
export function OtpStep({
  view,
  company,
  smsAvailable,
  onVerified,
}: {
  view: SignerView;
  company: string;
  smsAvailable: boolean;
  onVerified: () => void | Promise<void>;
}) {
  const [sentTo, setSentTo] = useState<string | null | undefined>(undefined);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const bySms = view.recipient.auth === 'sms_otp';

  if (bySms && !smsAvailable) {
    return (
      <SigningMessage
        icon={<MessageSquareOff aria-hidden className="h-6 w-6" />}
        title="Text message codes are not available"
        tone="warning"
      >
        <p>
          This document asks for a code by text message, but this install cannot send text messages.
          Ask {company} to send it to your email address instead.
        </p>
      </SigningMessage>
    );
  }

  async function send() {
    setPending(true);
    setError(null);
    try {
      const sent = await signFetch<{ sentTo: string | null }>('link/otp', { method: 'POST' });
      setSentTo(sent.sentTo);
      setCode('');
    } catch (err) {
      setError(otpProblem(err));
    } finally {
      setPending(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    const trimmed = code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(trimmed)) {
      setError('Enter the 6-digit code from the message.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await signFetch('link/otp/verify', {
        method: 'POST',
        body: JSON.stringify({ code: trimmed }),
      });
      await onVerified();
    } catch (err) {
      setError(otpProblem(err));
      setPending(false);
    }
  }

  const channel = bySms ? 'text message' : 'email';
  return (
    <SigningMessage
      icon={<KeyRound aria-hidden className="h-6 w-6" />}
      title="First, confirm it is you"
    >
      <p>
        {company} asked us to check who opens &ldquo;{view.envelope.title}&rdquo;. We will send a
        6-digit code by {channel}
        {view.recipient.email && !bySms ? ` to the address this link was sent to` : ''}.
      </p>
      {sentTo === undefined ? (
        <div className="space-y-3 pt-2">
          <Button type="button" onClick={() => void send()} pending={pending} className="w-full">
            Send me a code
          </Button>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <form onSubmit={verify} noValidate className="space-y-4 pt-2 text-left">
          <p className="text-sm" role="status">
            We sent a code{sentTo ? ` to ${sentTo}` : ''}. It works for 10 minutes.
          </p>
          <Field label="6-digit code" error={error ?? undefined}>
            {(props) => (
              <Input
                {...props}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="text-center font-mono text-lg tracking-[0.4em]"
              />
            )}
          </Field>
          <Button type="submit" pending={pending} className="w-full">
            Confirm
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            disabled={pending}
            onClick={() => void send()}
          >
            Send a new code
          </Button>
        </form>
      )}
    </SigningMessage>
  );
}

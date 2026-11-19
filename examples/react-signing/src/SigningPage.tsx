import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  createSignerClient,
  isSignApiError,
  type FieldValue,
  type Recipient,
  type SignerClient,
  type SigningSession,
} from '@codevibe_technology/sign-client';
import {
  SigningView,
  type PdfjsModule,
  type ViewerDocument,
} from '@codevibe_technology/sign-react';

const pdf = { pdfjs: pdfjs as unknown as PdfjsModule, workerSrc };

type Step =
  | { kind: 'loading' }
  | { kind: 'otp'; session: SigningSession }
  | { kind: 'sign'; session: SigningSession; documents: ViewerDocument[] }
  | { kind: 'message'; text: string };

export function SigningPage({ token }: { token: string }) {
  const signer = useMemo(
    () =>
      createSignerClient({
        // Same origin: the Vite dev server proxies /v1 to the Sign server.
        baseUrl: window.location.origin,
        token,
        sessionToken: storage.get(token),
      }),
    [token],
  );
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const [error, setError] = useState('');

  const open = useCallback(async () => {
    try {
      const session = await signer.session();
      if (!session.canAct) {
        return setStep({ kind: 'message', text: 'Others need to sign first. We will email you.' });
      }
      if (session.otpRequired && !session.authenticated) {
        return setStep({ kind: 'otp', session });
      }
      const documents = await Promise.all(
        session.documents.map(async (d) => ({
          id: d.id,
          name: d.name,
          file: await signer.document(d.id),
        })),
      );
      await signer.view();
      setStep({ kind: 'sign', session, documents });
    } catch (err) {
      setStep({ kind: 'message', text: messageFor(err) });
    }
  }, [signer]);

  useEffect(() => {
    void open();
  }, [open]);

  const act = (action: () => Promise<unknown>, done: string) => async () => {
    setError('');
    try {
      await action();
      storage.clear(token);
      setStep({ kind: 'message', text: done });
    } catch (err) {
      setError(messageFor(err));
    }
  };

  if (step.kind === 'loading') return <p className="notice">Loading…</p>;
  if (step.kind === 'message') return <p className="notice">{step.text}</p>;
  if (step.kind === 'otp') {
    return (
      <OtpForm
        signer={signer}
        onVerified={() => {
          storage.set(token, signer.sessionToken);
          void open();
        }}
      />
    );
  }

  const { session, documents } = step;
  return (
    <main>
      <h1>{session.envelope.title}</h1>
      {session.envelope.message && <p>{session.envelope.message}</p>}
      {error && <p className="error">{error}</p>}
      <SigningView
        documents={documents}
        fields={session.fields}
        recipient={asRecipient(session.recipient)}
        initialValues={session.values}
        pdf={pdf}
        onSubmit={(values: FieldValue[]) =>
          act(() => signer.submit(values), 'Thank you. You will get the signed copy by email.')()
        }
        onDecline={(reason) =>
          act(() => signer.decline(reason), 'You declined. The sender has been told.')()
        }
      />
    </main>
  );
}

function OtpForm({ signer, onVerified }: { signer: SignerClient; onVerified: () => void }) {
  const [sentTo, setSentTo] = useState<string | null>();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const send = async () => {
    setError('');
    try {
      setSentTo((await signer.requestOtp()).sentTo ?? 'you');
    } catch (err) {
      setError(messageFor(err));
    }
  };

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      await signer.verifyOtp(code.trim());
      onVerified();
    } catch (err) {
      setError(messageFor(err));
    }
  };

  return (
    <div className="notice">
      <p>To open the document, confirm it is you with a one-time code.</p>
      {sentTo === undefined ? (
        <button onClick={send}>Send me a code</button>
      ) : (
        <form onSubmit={verify}>
          <label htmlFor="otp">Code sent to {sentTo}</label>
          <input
            id="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button type="submit">Verify</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/** SigningView takes core's Recipient; the session carries the parts a signer may see. */
function asRecipient(r: SigningSession['recipient']): Recipient {
  return {
    id: r.id,
    name: r.name,
    role: r.role,
    status: r.status,
    auth: r.auth,
    order: 1,
    ...(r.email ? { email: r.email } : {}),
  };
}

function messageFor(err: unknown): string {
  if (!isSignApiError(err)) return 'Something went wrong. Try again.';
  switch (err.code) {
    case 'TOKEN_INVALID':
      return 'This link no longer works. It may have been used already or the request withdrawn.';
    case 'NETWORK':
    case 'TIMEOUT':
      return 'Could not reach the server. Check your connection and try again.';
    default:
      return err.message;
  }
}

/** Keeps the OTP session across reloads of this tab. */
const storage = {
  get(token: string): string | undefined {
    try {
      return sessionStorage.getItem(`cvsign:${token}`) ?? undefined;
    } catch {
      return undefined;
    }
  },
  set(token: string, value: string | undefined) {
    try {
      if (value) sessionStorage.setItem(`cvsign:${token}`, value);
    } catch {
      // Private mode: the signer verifies again after a reload.
    }
  },
  clear(token: string) {
    try {
      sessionStorage.removeItem(`cvsign:${token}`);
    } catch {
      // Storage is off; nothing was kept.
    }
  },
};

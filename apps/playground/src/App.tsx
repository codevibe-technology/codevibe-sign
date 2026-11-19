import { useEffect, useMemo, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { currentRecipients, SignError, type Field } from '@codevibe_technology/sign-core';
import {
  FieldPlacer,
  loadPdf,
  SigningView,
  type PdfjsModule,
  type PdfSource,
  type ViewerDocument,
} from '@codevibe_technology/sign-react';
import { samplePdf } from './samplePdf';
import {
  createDraft,
  declineAs,
  renameRecipient,
  sendDraft,
  sendIssues,
  submitAs,
  verify,
  viewAs,
  type Store,
} from './workflow';

const pdfOptions = { pdfjs: pdfjs as unknown as PdfjsModule, workerSrc };

const PEOPLE = [
  { name: 'Asha Rao', email: 'asha@example.com' },
  { name: 'Vikram Shah', email: 'vikram@example.com' },
];

function describe(error: unknown): string {
  if (error instanceof SignError) {
    const issues = error.details?.issues;
    if (Array.isArray(issues)) {
      return issues.map((i: { message?: string }) => i.message ?? '').join(' ');
    }
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export function App() {
  const [store, setStore] = useState<Store | null>(null);
  const [source, setSource] = useState<PdfSource | null>(null);
  const [fields, setFields] = useState<Field[]>([]);
  const [error, setError] = useState('');
  const [chainValid, setChainValid] = useState<boolean | null>(null);

  const envelope = store?.envelope;
  const doc = envelope?.documents[0];
  const documents: ViewerDocument[] = useMemo(
    () => (doc && source ? [{ id: doc.id, name: doc.name, source }] : []),
    [doc, source],
  );

  const open = async (name: string, bytes: Uint8Array) => {
    setError('');
    try {
      const loaded = await loadPdf(bytes, pdfOptions);
      source?.destroy?.();
      setSource(loaded);
      setFields([]);
      setChainValid(null);
      setStore(await createDraft(name, bytes, loaded.pages, PEOPLE));
    } catch (e) {
      setError(`That file could not be opened as a PDF. ${describe(e)}`);
    }
  };

  const reset = () => {
    source?.destroy?.();
    setSource(null);
    setStore(null);
    setFields([]);
    setError('');
    setChainValid(null);
  };

  const stage = !envelope ? 'start' : envelope.status === 'draft' ? 'prepare' : envelope.status;
  const signer = envelope ? currentRecipients(envelope)[0] : undefined;

  useEffect(() => {
    if (!store || !signer || signer.status !== 'notified') return;
    void viewAs(store, signer.id).then(setStore);
  }, [store, signer]);

  useEffect(() => {
    if (!store || store.envelope.status === 'draft') return;
    void verify(store).then(setChainValid);
  }, [store]);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Codevibe Sign playground</h1>
          <p>Send a PDF to two people and sign it in order. Everything stays in this tab.</p>
        </div>
        {envelope && (
          <button type="button" className="cvs-button" onClick={reset}>
            Start again
          </button>
        )}
      </header>

      {error && (
        <p className="app-error" role="alert">
          {error}
        </p>
      )}

      {stage === 'start' && (
        <section className="app-card">
          <h2>1. Choose a document</h2>
          <p>Pick any PDF from your computer, or use the sample offer letter.</p>
          <div className="app-row">
            <label className="cvs-button cvs-button--primary">
              Choose a PDF
              <input
                type="file"
                accept="application/pdf"
                className="cvs-visually-hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) await open(file.name, new Uint8Array(await file.arrayBuffer()));
                }}
              />
            </label>
            <button
              type="button"
              className="cvs-button"
              onClick={() => void open('offer-letter.pdf', samplePdf())}
            >
              Use the sample PDF
            </button>
          </div>
        </section>
      )}

      {stage === 'prepare' && store && envelope && (
        <section className="app-card app-card--wide">
          <div className="app-row app-row--spread">
            <h2>2. Place fields for each recipient</h2>
            <button
              type="button"
              className="cvs-button cvs-button--primary"
              onClick={async () => {
                const issues = sendIssues(store, fields);
                if (issues.length > 0) {
                  setError(issues.join(' '));
                  return;
                }
                try {
                  setError('');
                  setStore(await sendDraft(store, fields));
                } catch (e) {
                  setError(describe(e));
                }
              }}
            >
              Send for signing
            </button>
          </div>
          <div className="app-row">
            {envelope.recipients.map((r, i) => (
              <label key={r.id} className="app-person">
                Signer {i + 1}
                <input
                  className="cvs-input"
                  value={r.name}
                  onChange={(e) => setStore(renameRecipient(store, r.id, e.target.value))}
                />
              </label>
            ))}
          </div>
          <div className="app-placer">
            <FieldPlacer
              documents={documents}
              recipients={envelope.recipients}
              fields={fields}
              onChange={setFields}
            />
          </div>
        </section>
      )}

      {(stage === 'sent' || stage === 'in_progress') && store && envelope && signer && (
        <section className="app-card app-card--wide">
          <h2>
            3. Signing as {signer.name}{' '}
            <span className="app-muted">
              (signer {signer.order} of {envelope.recipients.length})
            </span>
          </h2>
          <div className="app-signing">
            <SigningView
              key={signer.id}
              documents={documents}
              fields={envelope.fields}
              recipient={signer}
              onSubmit={async (values) => {
                try {
                  setError('');
                  setStore(await submitAs(store, signer.id, values));
                  window.scrollTo({ top: 0 });
                } catch (e) {
                  setError(describe(e));
                }
              }}
              onDecline={async (reason) => setStore(await declineAs(store, signer.id, reason))}
            />
          </div>
        </section>
      )}

      {(stage === 'completed' || stage === 'declined') && store && envelope && (
        <section className="app-card">
          <h2>{stage === 'completed' ? 'All signed' : 'Declined'}</h2>
          <p>
            Envelope status: <strong>{envelope.status}</strong>. Audit chain of{' '}
            {store.events.length} events:{' '}
            <strong>
              {chainValid === null ? 'checking…' : chainValid ? 'verified' : 'broken'}
            </strong>
            .
          </p>
          <ul className="app-list">
            {envelope.recipients.map((r) => (
              <li key={r.id}>
                <strong>{r.name}</strong>: {r.status}
                {r.declineReason && ` (${r.declineReason})`}
                <div className="app-values">
                  {envelope.fields
                    .filter((f) => f.recipientId === r.id)
                    .map((f) => {
                      const value = envelope.values.find((v) => v.fieldId === f.id)?.value;
                      return (
                        <span key={f.id} className="app-value">
                          <span className="app-muted">{f.type}</span>
                          {value && (f.type === 'signature' || f.type === 'initials') ? (
                            <img
                              src={`data:image/png;base64,${value}`}
                              alt={`${f.type} of ${r.name}`}
                            />
                          ) : (
                            <span>{value ?? '—'}</span>
                          )}
                        </span>
                      );
                    })}
                </div>
              </li>
            ))}
          </ul>
          <details>
            <summary>Audit events</summary>
            <ol className="app-events">
              {store.events.map((e) => (
                <li key={e.seq}>
                  <code>{e.action}</code> <span className="app-muted">{e.at}</span>
                  <br />
                  <code className="app-hash">{e.hash}</code>
                </li>
              ))}
            </ol>
          </details>
        </section>
      )}
    </div>
  );
}

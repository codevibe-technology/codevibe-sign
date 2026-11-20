'use client';

import { FileText, Loader2, Lock, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  MAX_DOCUMENTS,
  MAX_PDF_BYTES,
  fileProblem,
  localId,
  type DraftDocument,
} from '@/lib/send-flow';
import type { ActionResult } from '@/server/actions/action';
import { inspectDocumentAction } from '@/server/actions/envelopes';
import { FileDrop } from '../file-drop';

const MB = 1024 * 1024;
const size = (bytes: number) =>
  bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Step 1: the PDFs. Each file is checked on the server (size, password protection, damage)
 * before it is accepted, so problems show up here and not at sending time.
 */
export function StepDocuments({
  workspaceId,
  documents,
  locked,
  lockedNote = 'The documents are saved with this draft and cannot be swapped. To send other files, start a new envelope.',
  error,
  inspect = inspectDocumentAction,
  onChange,
  onReplace,
}: {
  workspaceId: string;
  documents: DraftDocument[];
  lockedNote?: string;
  /** Checks a picked file on the server; the template editor also keeps it there. */
  inspect?: (
    form: FormData,
  ) => Promise<ActionResult<{ pages: DraftDocument['pages']; stagedKey?: string }>>;
  /** The draft exists; its documents can no longer change. */
  locked: boolean;
  error?: string;
  onChange: (update: (documents: DraftDocument[]) => DraftDocument[]) => void;
  /**
   * For a saved draft: uploads a new version of one document. Resolves with the fields that
   * had to move, or an error message.
   */
  onReplace?: (documentId: string, file: File) => Promise<{ moved: number } | { error: string }>;
}) {
  const [checking, setChecking] = useState<string[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function replace(documentId: string, file: File) {
    if (!onReplace) return;
    const problem = fileProblem(file);
    if (problem) {
      setProblems([problem]);
      return;
    }
    setReplacing(documentId);
    setProblems([]);
    setNotice(null);
    const result = await onReplace(documentId, file);
    setReplacing(null);
    if ('error' in result) setProblems([result.error]);
    else {
      setNotice(
        result.moved === 0
          ? `Replaced with ${file.name}. Every field is where it was.`
          : `Replaced with ${file.name}. ${result.moved === 1 ? '1 field was' : `${result.moved} fields were`} moved because its page changed; check ${result.moved === 1 ? 'it' : 'them'} on the next steps.`,
      );
    }
  }

  async function add(files: File[]) {
    const room = MAX_DOCUMENTS - documents.length;
    const found: string[] = [];
    if (files.length > room) {
      found.push(
        `An envelope holds up to ${MAX_DOCUMENTS} documents; only the first ${room} were added.`,
      );
    }
    const accepted = files.slice(0, Math.max(0, room)).filter((file) => {
      const problem = fileProblem(file);
      if (problem) found.push(problem);
      return !problem;
    });
    setProblems(found);
    setChecking(accepted.map((f) => f.name));
    await Promise.all(
      accepted.map(async (file) => {
        const form = new FormData();
        form.set('workspaceId', workspaceId);
        form.set('file', file);
        const result = await inspect(form);
        if (!result.ok) {
          setProblems((prev) => [...prev, result.error]);
        } else {
          const bytes = new Uint8Array(await file.arrayBuffer());
          onChange((docs) => [
            ...docs,
            {
              id: localId('doc'),
              name: file.name,
              size: file.size,
              pages: result.data.pages,
              bytes,
              ...(result.data.stagedKey ? { stagedKey: result.data.stagedKey } : {}),
            },
          ]);
        }
        setChecking((prev) => prev.filter((name) => name !== file.name));
      }),
    );
  }

  return (
    <div className="space-y-4">
      {locked ? (
        <p className="flex items-start gap-2 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-muted">
          <Lock aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          {onReplace
            ? 'The documents are saved with this draft. Replace a file with a new version if it changed; fields stay where they still fit.'
            : lockedNote}
        </p>
      ) : (
        <FileDrop
          multiple
          onFiles={(files) => void add(files)}
          title="Drop your PDFs here"
          hint={`Up to ${MAX_DOCUMENTS} files, ${MAX_PDF_BYTES / MB} MB each. Password-protected PDFs cannot be signed; remove the password first.`}
        />
      )}

      {notice ? (
        <p
          role="status"
          className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink"
        >
          {notice}
        </p>
      ) : null}

      {problems.length > 0 || error ? (
        <div
          role="alert"
          className="space-y-1 rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          {error ? <p>{error}</p> : null}
          {problems.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      ) : null}

      {documents.length > 0 || checking.length > 0 ? (
        <Card>
          <ul className="divide-y divide-line" aria-label="Documents">
            {documents.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                  <FileText aria-hidden className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{d.name}</p>
                  <p className="text-sm text-muted">
                    {d.pages.length} {d.pages.length === 1 ? 'page' : 'pages'}
                    {d.size ? ` · ${size(d.size)}` : ''}
                  </p>
                </div>
                {locked && onReplace ? (
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface-2">
                    {replacing === d.id ? (
                      <Loader2
                        aria-hidden
                        className="h-4 w-4 animate-spin motion-reduce:animate-none"
                      />
                    ) : (
                      <RefreshCw aria-hidden className="h-4 w-4" />
                    )}
                    Replace
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      className="sr-only"
                      aria-label={`Replace ${d.name}`}
                      disabled={replacing !== null}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) void replace(d.id, file);
                      }}
                    />
                  </label>
                ) : null}
                {locked ? null : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${d.name}`}
                    onClick={() => onChange((docs) => docs.filter((x) => x.id !== d.id))}
                  >
                    <Trash2 aria-hidden className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
            {checking.map((name) => (
              <li key={`checking-${name}`} className="flex items-center gap-3 px-4 py-3 text-muted">
                <Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                <span className="truncate">Checking {name}…</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

'use client';

import { Info, X } from 'lucide-react';
import { useState } from 'react';
import { EXCLUDED_DOCUMENTS, looksExcluded } from '@/lib/excluded-documents';

const LEGAL_NOTES = '/docs/legal';

/**
 * A light, dismissible reminder when a document name or title looks like one the IT Act does
 * not cover. It never stops the sender.
 */
export function ExcludedDocumentNotice({ names }: { names: string[] }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || !looksExcluded(names)) return null;
  return (
    <aside
      aria-label="Documents that cannot be signed electronically"
      className="mb-5 flex items-start gap-3 rounded-md border border-warning/40 border-l-[3px] border-l-warning bg-warning-soft px-4 py-3 text-sm text-ink"
    >
      <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          This looks like a document Indian law may not let you sign electronically.
        </p>
        <p className="mt-1 text-muted">
          The IT Act 2000 (First Schedule, as amended in 2022) does not apply to:
        </p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {EXCLUDED_DOCUMENTS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="mt-1.5 text-muted">
          You can still send it. Check with your lawyer first. This is not legal advice.{' '}
          <a href={LEGAL_NOTES} className="font-semibold text-primary hover:underline">
            Read the legal notes
          </a>
        </p>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss this notice"
        className="-m-1 rounded p-1 text-muted hover:bg-black/5 hover:text-ink"
      >
        <X aria-hidden className="h-4 w-4" />
      </button>
    </aside>
  );
}

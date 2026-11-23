'use client';

import { Check, Copy, ExternalLink, QrCode } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { useAction } from '@/components/settings/use-action';
import { setRecordRevokedAction } from '@/server/actions/public-records';

/**
 * The public record of a completed envelope: the page its certificate's QR code opens. Whoever
 * may withdraw the envelope may turn the page off, and on again.
 */
export function PublicRecordCard({
  workspaceId,
  envelopeId,
  url,
  revoked: initiallyRevoked,
  canManage,
}: {
  workspaceId: string;
  envelopeId: string;
  url: string;
  revoked: boolean;
  canManage: boolean;
}) {
  const [revoked, setRevoked] = useState(initiallyRevoked);
  const [copied, setCopied] = useState(false);
  const { pending, run } = useAction();

  function toggle() {
    const next = !revoked;
    run(() => setRecordRevokedAction({ workspaceId, envelopeId, revoked: next }), {
      success: next ? 'Public record turned off' : 'Public record turned on',
      onSuccess: () => setRevoked(next),
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Public record"
        description={
          revoked
            ? 'Turned off. The QR code on the certificate now opens a page that says the record is not available.'
            : 'The page the QR code on the certificate opens: seal status, signers and the audit trail. The document itself is never shown there.'
        }
        action={
          canManage ? (
            <Button
              size="sm"
              variant="secondary"
              pending={pending}
              onClick={toggle}
              data-testid="record-toggle"
            >
              {revoked ? 'Turn on' : 'Turn off'}
            </Button>
          ) : null
        }
      />
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 text-sm">
        <QrCode aria-hidden className="h-5 w-5 shrink-0 text-muted" />
        <code
          data-testid="record-url"
          className={`min-w-0 flex-1 font-mono text-xs break-all ${revoked ? 'text-muted line-through' : 'text-ink'}`}
        >
          {url}
        </code>
        {revoked ? null : (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={copy}>
              {copied ? (
                <Check aria-hidden className="h-4 w-4" />
              ) : (
                <Copy aria-hidden className="h-4 w-4" />
              )}
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <Button asChild size="sm" variant="secondary">
              <a href={url} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden className="h-4 w-4" />
                Open
              </a>
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

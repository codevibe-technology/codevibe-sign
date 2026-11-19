'use client';

import { Copy } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { updateSigningSettingsAction } from '@/server/actions/brand';
import { useAction } from './use-action';

export interface SigningBrandValues {
  showBadge: boolean;
  certificateFooter: string;
  signingDomain: string;
  signingDomainVerified: boolean;
}

/** The badge on the signing page, the certificate footer and the signing-page domain. */
export function SigningBrandForm({
  workspaceId,
  appHost,
  values,
}: {
  workspaceId: string;
  /** Where the custom domain's CNAME points. */
  appHost: string;
  values: SigningBrandValues;
}) {
  const [showBadge, setShowBadge] = useState(values.showBadge);
  const [footer, setFooter] = useState(values.certificateFooter);
  const [domain, setDomain] = useState(values.signingDomain);
  const save = useAction();
  const saved = values.signingDomain;

  function submit(event: FormEvent) {
    event.preventDefault();
    save.run(
      () =>
        updateSigningSettingsAction({
          workspaceId,
          showBadge,
          certificateFooter: footer,
          signingDomain: domain,
        }),
      { success: 'Signing page settings saved' },
    );
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied');
    } catch {
      toast.error('Copy did not work. Select the text and copy it instead.');
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <Card>
        <CardHeader
          title="Signing page and certificate"
          description="What signers see around the document, and the line on every certificate."
        />
        <CardBody className="space-y-6">
          <div className="flex items-start gap-3">
            <input
              id="show-badge"
              type="checkbox"
              role="switch"
              aria-checked={showBadge}
              checked={showBadge}
              onChange={(e) => setShowBadge(e.target.checked)}
              className="mt-1 h-5 w-5 shrink-0 accent-primary"
            />
            <div>
              <label htmlFor="show-badge" className="text-sm font-semibold">
                Show &ldquo;Secured by Codevibe Sign&rdquo;
              </label>
              <p className="text-sm text-muted">
                A small badge on the signing page and at the foot of emails. It tells signers who
                keeps the record.
              </p>
            </div>
          </div>

          <Field
            label="Certificate footer"
            hint="Printed at the end of the signing certificate, for example your company's registered name and number."
            error={save.errors.certificateFooter}
          >
            {(props) => (
              <Input
                {...props}
                maxLength={200}
                placeholder="Acme Private Limited, CIN U72900KA2020PTC000000"
                value={footer}
                onChange={(e) => setFooter(e.target.value)}
              />
            )}
          </Field>

          <div className="space-y-3">
            <Field
              label="Signing page domain"
              hint="Optional. Your own address for signing links, like sign.example.com."
              error={save.errors.signingDomain}
            >
              {(props) => (
                <Input
                  {...props}
                  inputMode="url"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="sign.example.com"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                />
              )}
            </Field>
            {saved ? (
              <div
                className="space-y-3 rounded-lg border border-line bg-surface-2 p-4 text-sm"
                data-testid="dns-instructions"
              >
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  {saved}
                  {values.signingDomainVerified ? (
                    <Badge tone="success">Connected</Badge>
                  ) : (
                    <Badge tone="warning">Waiting for DNS</Badge>
                  )}
                </p>
                <p>Add this record where you manage the DNS for {saved}:</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs sm:text-sm">
                  <dt className="text-muted">Type</dt>
                  <dd>CNAME</dd>
                  <dt className="text-muted">Name</dt>
                  <dd className="break-all">{saved}</dd>
                  <dt className="text-muted">Value</dt>
                  <dd className="flex items-center gap-2 break-all">
                    {appHost}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Copy the CNAME value"
                      onClick={() => void copy(appHost)}
                    >
                      <Copy aria-hidden className="h-4 w-4" />
                    </Button>
                  </dd>
                </dl>
                <p className="text-muted">
                  DNS changes can take up to a day to reach everyone. Once the record is in place,
                  the operator of this install turns on the certificate for the domain and links
                  start using it. Until then, signing links keep using {appHost}.
                </p>
              </div>
            ) : null}
          </div>
        </CardBody>
        <CardFooter>
          <Button type="submit" pending={save.pending}>
            Save signing page settings
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

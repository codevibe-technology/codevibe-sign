'use client';

import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Send, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FileDrop } from '@/components/envelopes/file-drop';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import {
  MAX_BULK_CSV_BYTES,
  MAX_BULK_ROWS,
  fixedPeopleProblems,
  previewBulkCsv,
  sampleCsv,
  sampleCsvName,
} from '@/lib/bulk-send';
import { cn } from '@/lib/cn';
import { emptyPerson, type People, type TemplateDefinition } from '@/lib/templates';
import { startBulkSendAction } from '@/server/actions/templates';

/** Rows shown in the preview table; the rest are counted. */
export const PREVIEW_ROWS = 50;

/**
 * Upload a CSV, see every row with its problems pointing at the column, fill in roles that are
 * the same for everyone, then start sending. The server reads the file again before sending.
 */
export function BulkSendForm({
  slug,
  workspaceId,
  template,
}: {
  slug: string;
  workspaceId: string;
  template: { id: string; name: string; definition: TemplateDefinition };
}) {
  const router = useRouter();
  const { definition } = template;
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fixed, setFixed] = useState<People>({});
  const [skip, setSkip] = useState(false);
  const [showFixed, setShowFixed] = useState(false);
  const [starting, setStarting] = useState(false);

  const preview = useMemo(
    () => (file ? previewBulkCsv(file.text, template, definition, fixed) : null),
    [file, template, definition, fixed],
  );
  const fixedProblems = useMemo(
    () => (preview ? fixedPeopleProblems(preview.fixedRoles, fixed) : {}),
    [preview, fixed],
  );

  async function pick(files: File[]) {
    const picked = files[0];
    if (!picked) return;
    setSkip(false);
    if (!/\.csv$/i.test(picked.name) && !/csv|text\/plain/.test(picked.type)) {
      setFileError(
        `${picked.name} is not a CSV file. In your spreadsheet, choose File, Download (or Save as), then CSV.`,
      );
      return;
    }
    if (picked.size > MAX_BULK_CSV_BYTES) {
      setFileError(`${picked.name} is larger than 1 MB. Split it into smaller files.`);
      return;
    }
    setFileError(null);
    setFile({ name: picked.name, text: await picked.text() });
  }

  function downloadSample() {
    const blob = new Blob([sampleCsv(definition)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = sampleCsvName(template.name);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function start() {
    if (!preview || !file) return;
    if (Object.keys(fixedProblems).length > 0) {
      setShowFixed(true);
      return;
    }
    setStarting(true);
    try {
      const result = await startBulkSendAction({
        workspaceId,
        templateId: template.id,
        csv: file.text,
        fixed,
        skipProblems: skip,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Sending ${result.data.count} envelopes. You can leave this page.`);
      router.push(`/w/${slug}/templates/bulk/${result.data.bulkId}`);
    } finally {
      setStarting(false);
    }
  }

  const problemCells = new Set(
    (preview?.problems ?? []).filter((p) => p.column).map((p) => `${p.line}:${p.column}`),
  );
  const problemLines = new Set((preview?.problems ?? []).map((p) => p.line));
  const rowProblems = preview ? preview.problems.filter((p) => p.line > 1) : [];
  const badRows = new Set(rowProblems.map((p) => p.line)).size;
  const canStart =
    preview !== null && !preview.blocking && preview.ready.length > 0 && (badRows === 0 || skip);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="1. Prepare the file"
          description="One row per envelope. The first row names the columns."
          action={
            <Button type="button" variant="secondary" size="sm" onClick={downloadSample}>
              <Download aria-hidden className="h-4 w-4" />
              Sample CSV
            </Button>
          }
        />
        <div className="space-y-3 px-5 py-4 text-sm">
          <p className="text-muted">Columns this template understands:</p>
          <ul className="flex flex-wrap gap-2" aria-label="Columns">
            {definition.roles.flatMap((role) => [
              <li key={`${role.id}-n`}>
                <code className="rounded bg-surface-2 px-1.5 py-0.5 text-[13px]">
                  {role.name} name
                </code>
              </li>,
              <li key={`${role.id}-e`}>
                <code className="rounded bg-surface-2 px-1.5 py-0.5 text-[13px]">
                  {role.name} email
                </code>
              </li>,
              ...(role.auth === 'sms_otp'
                ? [
                    <li key={`${role.id}-p`}>
                      <code className="rounded bg-surface-2 px-1.5 py-0.5 text-[13px]">
                        {role.name} phone
                      </code>
                    </li>,
                  ]
                : []),
            ])}
            <li>
              <code className="rounded bg-surface-2 px-1.5 py-0.5 text-[13px]">
                meta.&lt;anything&gt;
              </code>
            </li>
          </ul>
          <p className="text-muted">
            Leave out the columns of a role that is the same for everyone (for example HR) and fill
            it in once below. <code>meta.</code> columns are kept on each envelope and sent in
            webhooks, for example <code>meta.employeeId</code>.
          </p>
        </div>
      </Card>

      <section aria-labelledby="bulk-upload" className="space-y-3">
        <h2 id="bulk-upload" className="text-base font-semibold text-ink">
          2. Upload it
        </h2>
        {file ? (
          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
            <FileSpreadsheet aria-hidden className="h-5 w-5 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{file.name}</p>
              <p className="text-sm text-muted">
                {preview?.total ?? 0} {preview?.total === 1 ? 'row' : 'rows'}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remove the file"
              onClick={() => {
                setFile(null);
                setSkip(false);
              }}
            >
              <X aria-hidden className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <FileDrop
            onFiles={(files) => void pick(files)}
            accept=".csv,text/csv"
            title="Drop your CSV here"
            hint={`Up to ${MAX_BULK_ROWS} rows. Export it from Excel, Google Sheets or Numbers as CSV.`}
          />
        )}
        {fileError ? (
          <p
            role="alert"
            className="rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger"
          >
            {fileError}
          </p>
        ) : null}
      </section>

      {preview ? (
        <section aria-labelledby="bulk-check" className="space-y-4">
          <h2 id="bulk-check" className="text-base font-semibold text-ink">
            3. Check and send
          </h2>

          <div className="flex flex-wrap gap-2" aria-live="polite">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-3 py-1 text-sm font-semibold text-success">
              <CheckCircle2 aria-hidden className="h-4 w-4" />
              {preview.ready.length} ready
            </span>
            {badRows > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-soft px-3 py-1 text-sm font-semibold text-danger">
                <AlertTriangle aria-hidden className="h-4 w-4" />
                {badRows} {badRows === 1 ? 'row has' : 'rows have'} problems
              </span>
            ) : null}
          </div>

          {preview.problems.length > 0 ? (
            <div
              role="alert"
              className="rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger"
            >
              <p className="font-semibold">
                {preview.blocking
                  ? 'Fix the file, then upload it again:'
                  : 'Fix these rows in your spreadsheet and upload again, or skip them:'}
              </p>
              <ul className="mt-1 max-h-60 list-disc space-y-1 overflow-y-auto pl-5">
                {preview.problems.slice(0, 100).map((p, i) => (
                  <li key={i}>
                    <span className="font-semibold">
                      {p.line === 1 ? 'Header' : `Row ${p.line}`}
                      {p.column ? `, column "${p.column}"` : ''}:
                    </span>{' '}
                    {p.message}
                  </li>
                ))}
                {preview.problems.length > 100 ? (
                  <li>and {preview.problems.length - 100} more.</li>
                ) : null}
              </ul>
            </div>
          ) : null}

          {preview.fixedRoles.length > 0 && !preview.blocking ? (
            <Card>
              <CardHeader
                title="Same for every envelope"
                description="These roles have no columns in the file, so the same person takes them in every envelope."
              />
              <div className="space-y-4 px-5 py-4">
                {preview.fixedRoles.map((role) => {
                  const person = fixed[role.id] ?? emptyPerson();
                  const at = `people.${role.id}`;
                  const setPerson = (patch: Partial<typeof person>) =>
                    setFixed((all) => ({ ...all, [role.id]: { ...person, ...patch } }));
                  return (
                    <fieldset key={role.id} className="grid gap-3 sm:grid-cols-2">
                      <legend className="mb-2 text-sm font-semibold">{role.name}</legend>
                      <Field
                        label={`${role.name} name`}
                        error={showFixed ? fixedProblems[`${at}.name`] : undefined}
                      >
                        {(props) => (
                          <Input
                            {...props}
                            value={person.name}
                            onChange={(e) => setPerson({ name: e.target.value })}
                          />
                        )}
                      </Field>
                      <Field
                        label={`${role.name} email`}
                        error={showFixed ? fixedProblems[`${at}.email`] : undefined}
                      >
                        {(props) => (
                          <Input
                            {...props}
                            type="email"
                            value={person.email}
                            onChange={(e) => setPerson({ email: e.target.value })}
                          />
                        )}
                      </Field>
                      {role.auth === 'sms_otp' ? (
                        <Field
                          label={`${role.name} mobile`}
                          error={showFixed ? fixedProblems[`${at}.phone`] : undefined}
                        >
                          {(props) => (
                            <Input
                              {...props}
                              type="tel"
                              value={person.phone}
                              onChange={(e) => setPerson({ phone: e.target.value })}
                            />
                          )}
                        </Field>
                      ) : null}
                    </fieldset>
                  );
                })}
              </div>
            </Card>
          ) : null}

          {preview.headers.length > 0 && preview.cells.length > 0 ? (
            <Card className="overflow-hidden">
              <div className="max-h-[28rem] overflow-auto">
                <table className="w-full min-w-max text-left text-sm">
                  <caption className="sr-only">Rows in {file?.name}</caption>
                  <thead className="sticky top-0 bg-surface-2 text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-semibold">
                        Row
                      </th>
                      {preview.headers.map((h, i) => (
                        <th
                          key={i}
                          scope="col"
                          className={cn(
                            'px-3 py-2 font-semibold',
                            problemCells.has(`1:${h}`) && 'bg-danger-soft text-danger',
                          )}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {preview.cells.slice(0, PREVIEW_ROWS).map((row) => {
                      const bad = problemLines.has(row.line);
                      return (
                        <tr key={row.line} className={bad ? 'bg-danger-soft/40' : undefined}>
                          <th scope="row" className="px-3 py-2 font-medium text-muted">
                            {bad ? (
                              <AlertTriangle
                                aria-label="Has a problem"
                                className="mr-1 inline h-3.5 w-3.5 text-danger"
                              />
                            ) : null}
                            {row.line}
                          </th>
                          {preview.headers.map((h, i) => (
                            <td
                              key={i}
                              className={cn(
                                'max-w-60 truncate px-3 py-2',
                                problemCells.has(`${row.line}:${h}`) &&
                                  'font-semibold text-danger ring-1 ring-inset ring-danger/50',
                              )}
                            >
                              {row.values[i] ?? ''}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {preview.cells.length > PREVIEW_ROWS ? (
                <p className="border-t border-line px-4 py-2 text-sm text-muted">
                  Showing the first {PREVIEW_ROWS} of {preview.cells.length} rows.
                </p>
              ) : null}
            </Card>
          ) : null}

          {badRows > 0 && !preview.blocking && preview.ready.length > 0 ? (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={skip}
                onChange={(e) => setSkip(e.target.checked)}
                className="mt-0.5 accent-[var(--primary)]"
              />
              <span>
                Skip the {badRows} {badRows === 1 ? 'row' : 'rows'} with problems and send the other{' '}
                {preview.ready.length}.
              </span>
            </label>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-3">
            <p className="text-sm text-muted">
              Sending runs in the background at about 60 envelopes a minute.
            </p>
            <Button
              type="button"
              onClick={() => void start()}
              disabled={!canStart}
              pending={starting}
            >
              <Send aria-hidden className="h-4 w-4" />
              {preview.ready.length === 1
                ? 'Send 1 envelope'
                : `Send ${preview.ready.length} envelopes`}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

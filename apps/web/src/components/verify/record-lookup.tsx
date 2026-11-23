'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { parseRecordId, recordPath } from '@/lib/public-record';

/** Opens a record from the link under the QR code on a certificate, or the code at its end. */
export function RecordLookup() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | undefined>();

  function submit(event: FormEvent) {
    event.preventDefault();
    const id = parseRecordId(value);
    if (!id) {
      setError('Paste the whole link printed under the QR code on the certificate page.');
      return;
    }
    setError(undefined);
    router.push(recordPath(id));
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-1.5">
      <label htmlFor="record-link" className="block text-[13px] font-semibold text-ink">
        Record link
      </label>
      <div className="flex flex-wrap gap-2">
        <Input
          id="record-link"
          className="min-w-0 flex-1 basis-56"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="https://…/r/…"
          autoComplete="off"
          spellCheck={false}
          aria-describedby="record-link-note"
          aria-invalid={error ? true : undefined}
        />
        <Button type="submit" variant="secondary">
          Open record
        </Button>
      </div>
      <p
        id="record-link-note"
        role={error ? 'alert' : undefined}
        className={error ? 'text-[13px] text-danger' : 'text-[13px] text-muted'}
      >
        {error ?? 'Scanning the QR code on the certificate page opens the same record.'}
      </p>
    </form>
  );
}

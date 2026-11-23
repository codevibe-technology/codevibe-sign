import { useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  MAX_NAME_LENGTH,
  MAX_TEXT_LENGTH,
  type Field,
  type FieldValue,
  type Recipient,
} from '@codevibe_technology/sign-core';
import { pointsToPixels } from '../geometry';
import { defaultFieldTypeLabels, mergeLabels } from '../labels';
import type { LoadPdfOptions } from '../pdf/pdfjs';
import type { ViewerDocument } from '../pdf/types';
import { usePdfSources } from '../pdf/usePdfSources';
import { SignaturePad, type SignaturePadProps } from '../signature/SignaturePad';
import {
  DocumentPages,
  ZoomControls,
  defaultViewerLabels,
  useElementWidth,
  type PageContext,
  type ViewerLabels,
} from '../viewer/DocumentPages';
import { Dialog } from './Dialog';
import {
  fieldStatus,
  hasValue,
  initialsOf,
  prefillValues,
  sortFields,
  toFieldValues,
  validateFieldValues,
  type FieldValues,
} from './values';

export interface SigningViewLabels extends ViewerLabels {
  fieldTypes: typeof defaultFieldTypeLabels;
  signHere: string;
  initialHere: string;
  required: string;
  optional: string;
  progress: (done: number, total: number) => string;
  nextField: string;
  finish: string;
  submitting: string;
  decline: string;
  declineTitle: string;
  declineReason: string;
  declineConfirm: string;
  cancel: string;
  signatureTitle: string;
  initialsTitle: string;
  apply: string;
  /** The button that fills every empty initials box with the adopted initials. */
  fillInitials: (count: number) => string;
  missing: (count: number) => string;
  formatDate: (isoDate: string) => string;
}

export const defaultSigningViewLabels: SigningViewLabels = {
  ...defaultViewerLabels,
  fieldTypes: defaultFieldTypeLabels,
  signHere: 'Sign',
  initialHere: 'Initial',
  required: 'required',
  optional: 'optional',
  progress: (done, total) => `${done} of ${total} required fields done`,
  nextField: 'Next field',
  finish: 'Finish',
  submitting: 'Sending…',
  decline: 'Decline',
  declineTitle: 'Decline to sign',
  declineReason: 'Tell the sender why you are declining',
  declineConfirm: 'Decline',
  cancel: 'Cancel',
  signatureTitle: 'Add your signature',
  initialsTitle: 'Add your initials',
  apply: 'Apply',
  fillInitials: (count) => `Fill all my initials (${count})`,
  missing: (count) =>
    count === 1 ? '1 required field still needs you.' : `${count} required fields still need you.`,
  formatDate: (iso) => {
    const date = new Date(`${iso}T00:00:00`);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString();
  },
};

export interface SigningViewProps {
  documents: ViewerDocument[];
  /** Fields of the envelope; only those of `recipient` are shown and collected. */
  fields: Field[];
  /** Only `id` and `name` are used, so the server's signer view can be passed as is. */
  recipient: Pick<Recipient, 'id' | 'name'>;
  /** Values already saved for this recipient, for example from a previous visit. */
  initialValues?: FieldValue[];
  onSubmit: (values: FieldValue[]) => void | Promise<void>;
  onDecline?: (reason: string) => void | Promise<void>;
  /** Date used for date fields. Defaults to now. */
  today?: Date;
  signaturePad?: Pick<SignaturePadProps, 'fonts' | 'colors' | 'modes' | 'upload' | 'labels'>;
  pdf?: LoadPdfOptions;
  labels?: Partial<SigningViewLabels>;
  className?: string;
}

type Adoptable = 'signature' | 'initials';

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function SigningView({
  documents,
  fields: allFields,
  recipient,
  initialValues,
  onSubmit,
  onDecline,
  today,
  signaturePad,
  pdf,
  labels: labelOverrides,
  className,
}: SigningViewProps) {
  const labels = mergeLabels(defaultSigningViewLabels, labelOverrides);
  const id = useId();
  const states = usePdfSources(documents, pdf);
  const fields = useMemo(
    () =>
      sortFields(
        allFields.filter((f) => f.recipientId === recipient.id),
        documents.map((d) => d.id),
      ),
    [allFields, recipient.id, documents],
  );

  const [values, setValues] = useState<FieldValues>(() => {
    const start = prefillValues(fields, recipient, today ?? new Date());
    for (const v of initialValues ?? []) start[v.fieldId] = v.value;
    return start;
  });
  const [adopted, setAdopted] = useState<Partial<Record<Adoptable, string>>>({});
  const [padField, setPadField] = useState<Field | null>(null);
  const [padValue, setPadValue] = useState<string | null>(null);
  // Set when the pad was opened by "Fill all my initials": applying fills every empty box.
  const [fillAll, setFillAll] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const scroller = useRef<HTMLDivElement>(null);
  const width = useElementWidth(scroller);
  const [zoom, setZoom] = useState(1);
  const fieldEls = useRef(new Map<string, HTMLElement>());
  const finishButton = useRef<HTMLButtonElement>(null);
  const lastFocused = useRef<string | null>(null);

  const required = fields.filter((f) => f.required);
  const done = required.filter((f) => hasValue(f, values[f.id])).length;

  const setValue = (fieldId: string, value: string) =>
    setValues((prev) => ({ ...prev, [fieldId]: value }));

  const focusField = (fieldId: string) => {
    const el = fieldEls.current.get(fieldId);
    if (!el) return;
    el.scrollIntoView?.({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
    lastFocused.current = fieldId;
  };

  const goToNextField = () => {
    const start = fields.findIndex((f) => f.id === lastFocused.current);
    const ordered = [...fields.slice(start + 1), ...fields.slice(0, start + 1)];
    const next =
      ordered.find((f) => f.required && !hasValue(f, values[f.id])) ??
      ordered.find((f) => !hasValue(f, values[f.id]) && f.type !== 'date_signed');
    if (next) focusField(next.id);
    else finishButton.current?.focus();
  };

  const openPad = (field: Field) => {
    const type = field.type as Adoptable;
    const reuse = adopted[type];
    if (!hasValue(field, values[field.id]) && reuse) {
      setValue(field.id, reuse);
      return;
    }
    setPadValue(values[field.id] || reuse || null);
    setPadField(field);
  };

  const emptyInitials = fields.filter((f) => f.type === 'initials' && !hasValue(f, values[f.id]));
  const initialsCount = fields.filter((f) => f.type === 'initials').length;

  const fillInitials = (value: string) =>
    setValues((prev) => {
      const next = { ...prev };
      for (const f of fields) {
        if (f.type === 'initials' && !hasValue(f, next[f.id])) next[f.id] = value;
      }
      return next;
    });

  const fillAllInitials = () => {
    const first = emptyInitials[0];
    if (!first) return;
    if (adopted.initials) {
      fillInitials(adopted.initials);
      return;
    }
    setFillAll(true);
    setPadValue(null);
    setPadField(first);
  };

  const closePad = () => {
    setPadField(null);
    setFillAll(false);
  };

  const applyPad = () => {
    if (!padField) return;
    if (padValue) {
      setValue(padField.id, padValue);
      setAdopted((prev) => ({ ...prev, [padField.type]: padValue }));
      if (fillAll && padField.type === 'initials') fillInitials(padValue);
    } else {
      setValues((prev) => {
        const next = { ...prev };
        delete next[padField.id];
        return next;
      });
    }
    closePad();
  };

  const submit = async () => {
    const result = validateFieldValues(fields, values);
    if (!result.valid) {
      setShowErrors(true);
      const count = result.missing.length + result.invalid.length;
      setMessage(labels.missing(count));
      const first = fields.find(
        (f) => result.missing.includes(f.id) || result.invalid.includes(f.id),
      );
      if (first) focusField(first.id);
      return;
    }
    setMessage('');
    setBusy(true);
    try {
      await onSubmit(toFieldValues(fields, values));
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const confirmDecline = async () => {
    if (!onDecline || !reason.trim()) return;
    setBusy(true);
    try {
      await onDecline(reason.trim());
      setDeclining(false);
    } catch (error) {
      setDeclining(false);
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const register = (fieldId: string) => (el: HTMLElement | null) => {
    if (el) fieldEls.current.set(fieldId, el);
    else fieldEls.current.delete(fieldId);
  };

  const renderField = (field: Field, scale: number) => {
    const box = pointsToPixels(field.rect, scale);
    const value = values[field.id];
    const status = fieldStatus(field, value, showErrors);
    const typeLabel = field.label || labels.fieldTypes[field.type];
    const name = `${typeLabel}, ${field.required ? labels.required : labels.optional}`;
    const style = {
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      '--cvs-field-font': `${Math.max(10, Math.min(box.height * 0.62, 28))}px`,
    } as CSSProperties;
    const common = {
      'data-state': status,
      'data-required': field.required || undefined,
      'data-type': field.type,
      onFocus: () => {
        lastFocused.current = field.id;
      },
    };

    if (field.type === 'signature' || field.type === 'initials') {
      return (
        <button
          key={field.id}
          ref={register(field.id)}
          type="button"
          className="cvs-field cvs-field--sign"
          style={style}
          aria-label={name}
          aria-invalid={status === 'invalid' || undefined}
          onClick={() => openPad(field)}
          {...common}
        >
          {value ? (
            <img src={`data:image/png;base64,${value}`} alt="" className="cvs-field-image" />
          ) : (
            <span className="cvs-field-cta">
              {field.type === 'signature' ? labels.signHere : labels.initialHere}
            </span>
          )}
        </button>
      );
    }

    if (field.type === 'checkbox') {
      return (
        <label key={field.id} className="cvs-field cvs-field--check" style={style} {...common}>
          <input
            ref={register(field.id)}
            type="checkbox"
            aria-label={name}
            aria-invalid={status === 'invalid' || undefined}
            checked={value === 'true'}
            onChange={(e) => setValue(field.id, e.target.checked ? 'true' : 'false')}
          />
        </label>
      );
    }

    if (field.type === 'date_signed') {
      return (
        <div
          key={field.id}
          ref={register(field.id)}
          className="cvs-field cvs-field--date"
          style={style}
          role="note"
          aria-label={`${typeLabel}: ${value ? labels.formatDate(value) : ''}`}
          {...common}
        >
          {value ? labels.formatDate(value) : ''}
        </div>
      );
    }

    return (
      <input
        key={field.id}
        ref={register(field.id)}
        className="cvs-field cvs-field--text"
        style={style}
        type="text"
        aria-label={name}
        aria-invalid={status === 'invalid' || undefined}
        required={field.required}
        maxLength={field.type === 'name' ? MAX_NAME_LENGTH : MAX_TEXT_LENGTH}
        autoComplete={field.type === 'name' ? 'name' : 'off'}
        value={value ?? ''}
        placeholder={typeLabel}
        onChange={(e) => setValue(field.id, e.target.value)}
        {...common}
      />
    );
  };

  const renderOverlay = ({ documentId, pageIndex, scale }: PageContext) =>
    fields
      .filter((f) => f.documentId === documentId && f.page === pageIndex)
      .map((f) => renderField(f, scale));

  const padAspect = padField
    ? Math.min(4, Math.max(1, padField.rect.width / Math.max(1, padField.rect.height)))
    : 3;

  return (
    <div className={['cvs-root', 'cvs-signing', className].filter(Boolean).join(' ')}>
      <div className="cvs-viewer-bar">
        <ZoomControls zoom={zoom} onZoom={setZoom} labels={labels} />
      </div>
      <div ref={scroller} className="cvs-scroller" tabIndex={0}>
        <DocumentPages
          documents={documents}
          states={states}
          containerWidth={width}
          zoom={zoom}
          labels={labels}
          renderOverlay={renderOverlay}
        />
      </div>

      <div className="cvs-action-bar">
        {onDecline && (
          <button
            type="button"
            className="cvs-button cvs-button--ghost"
            onClick={() => setDeclining(true)}
            disabled={busy}
          >
            {labels.decline}
          </button>
        )}
        <p className="cvs-progress" id={`${id}-progress`}>
          {labels.progress(done, required.length)}
        </p>
        <span className="cvs-spacer" />
        {initialsCount > 1 && emptyInitials.length > 0 && (
          <button type="button" className="cvs-button" onClick={fillAllInitials} disabled={busy}>
            {labels.fillInitials(emptyInitials.length)}
          </button>
        )}
        <button type="button" className="cvs-button" onClick={goToNextField} disabled={busy}>
          {labels.nextField}
        </button>
        <button
          ref={finishButton}
          type="button"
          className="cvs-button cvs-button--primary"
          onClick={() => void submit()}
          disabled={busy}
          aria-describedby={`${id}-progress`}
        >
          {busy ? labels.submitting : labels.finish}
        </button>
        <p className="cvs-error cvs-action-message" role="status" aria-live="polite">
          {message}
        </p>
      </div>

      {padField && (
        <Dialog
          title={padField.type === 'initials' ? labels.initialsTitle : labels.signatureTitle}
          onClose={closePad}
          footer={
            <>
              <button type="button" className="cvs-button cvs-button--ghost" onClick={closePad}>
                {labels.cancel}
              </button>
              <button
                type="button"
                className="cvs-button cvs-button--primary"
                onClick={applyPad}
                disabled={!padValue && !values[padField.id]}
              >
                {labels.apply}
              </button>
            </>
          }
        >
          <SignaturePad
            {...signaturePad}
            value={padValue}
            onChange={setPadValue}
            aspectRatio={padAspect}
            defaultText={padField.type === 'initials' ? initialsOf(recipient.name) : recipient.name}
          />
        </Dialog>
      )}

      {declining && (
        <Dialog
          title={labels.declineTitle}
          onClose={() => setDeclining(false)}
          footer={
            <>
              <button
                type="button"
                className="cvs-button cvs-button--ghost"
                onClick={() => setDeclining(false)}
              >
                {labels.cancel}
              </button>
              <button
                type="button"
                className="cvs-button cvs-button--danger"
                onClick={() => void confirmDecline()}
                disabled={!reason.trim() || busy}
              >
                {labels.declineConfirm}
              </button>
            </>
          }
        >
          <label className="cvs-label" htmlFor={`${id}-reason`}>
            {labels.declineReason}
          </label>
          <textarea
            id={`${id}-reason`}
            className="cvs-input cvs-textarea"
            rows={4}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Dialog>
      )}
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

import { useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  MAX_NAME_LENGTH,
  MAX_TEXT_LENGTH,
  type Field,
  type FieldType,
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
  /** The guide button before the signer has touched a field: it goes to the first one. */
  start: string;
  /** The guide button once started: it goes to the next field that still needs the signer. */
  next: string;
  /** Goes to the next empty optional field once every required one is done. */
  nextField: string;
  /** The small flag that marks the field the guide is on. */
  guideFlag: (type: FieldType) => string;
  /** Names the scrolling area that holds the pages. */
  documentRegion: string;
  /** Names the bar with the progress and the Start, Next and Finish buttons. */
  actions: string;
  /** Under the signature pad when the signer has more signature boxes to fill. */
  reuseSignature: string;
  /** Under the signature pad when the signer has more initials boxes to fill. */
  reuseInitials: string;
  finish: string;
  submitting: string;
  /** On the Aadhaar eSign box, which the signer does not fill: they sign it at the provider. */
  aadhaarBox: string;
  aadhaarBoxNote: string;
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
  /** One line under the signature pad saying what adopting a signature means. */
  adoptTerms: string;
  /** Ready-made reasons the signer can pick when declining; each fills in the reason box. */
  declineReasons: string[];
  /** Shown in the bar once every required field is done. */
  allDone: string;
  /** The question before finishing, when `confirmBeforeFinish` is on. */
  confirmTitle: string;
  confirmBody: (filled: number) => string;
  confirmFinish: string;
  /** The tab in the page margin that points at the field the guide is on. */
  guideTab: string;
}

export const defaultSigningViewLabels: SigningViewLabels = {
  ...defaultViewerLabels,
  fieldTypes: defaultFieldTypeLabels,
  signHere: 'Sign',
  initialHere: 'Initial',
  required: 'required',
  optional: 'optional',
  progress: (done, total) => `${done} of ${total} required fields done`,
  start: 'Start',
  next: 'Next',
  nextField: 'Next field',
  guideFlag: (type) =>
    type === 'signature'
      ? 'Sign here'
      : type === 'initials'
        ? 'Initial here'
        : type === 'checkbox'
          ? 'Tick here'
          : 'Fill in',
  documentRegion: 'Document pages',
  actions: 'Signing progress and actions',
  reuseSignature: 'Your other signature boxes take this signature with one tap.',
  reuseInitials: 'Your other initials boxes take these initials with one tap.',
  finish: 'Finish',
  submitting: 'Sending…',
  aadhaarBox: 'Aadhaar eSign',
  aadhaarBoxNote: 'You sign here with Aadhaar eSign after you finish',
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
  adoptTerms:
    'By adopting it, you agree this is your electronic signature on this document, as binding as one written by hand.',
  declineReasons: [
    'Something in the document needs to change',
    'The details about me are wrong',
    'I am not the right person to sign',
  ],
  allDone: 'All required fields are done.',
  confirmTitle: 'Ready to finish?',
  confirmBody: (filled) =>
    `You filled in ${filled === 1 ? '1 field' : `${filled} fields`}. When you finish, your signature is applied to the document and the sender is told. You cannot change it afterwards.`,
  confirmFinish: 'Finish',
  guideTab: 'Next',
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
  /** Asks the signer to confirm before `onSubmit` is called. */
  confirmBeforeFinish?: boolean;
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
  confirmBeforeFinish = false,
}: SigningViewProps) {
  const labels = mergeLabels(defaultSigningViewLabels, labelOverrides);
  const id = useId();
  const states = usePdfSources(documents, pdf);
  const own = useMemo(
    () =>
      sortFields(
        allFields.filter((f) => f.recipientId === recipient.id),
        documents.map((d) => d.id),
      ),
    [allFields, recipient.id, documents],
  );
  // The Aadhaar eSign box is shown where it sits but takes nothing here: the signer signs
  // it at the eSign provider once they finish.
  const fields = useMemo(() => own.filter((f) => f.type !== 'aadhaar'), [own]);
  const esignBoxes = useMemo(() => own.filter((f) => f.type === 'aadhaar'), [own]);

  const [values, setValues] = useState<FieldValues>(() => {
    const start = prefillValues(fields, recipient, today ?? new Date());
    for (const v of initialValues ?? []) start[v.fieldId] = v.value;
    return start;
  });
  // The signature and initials the signer has adopted: later boxes take them with one tap.
  // A value saved on an earlier visit counts, so coming back does not mean drawing again.
  const [adopted, setAdopted] = useState<Partial<Record<Adoptable, string>>>(() => {
    const seed: Partial<Record<Adoptable, string>> = {};
    for (const f of fields) {
      if (f.type !== 'signature' && f.type !== 'initials') continue;
      const value = values[f.id];
      if (value && !seed[f.type]) seed[f.type] = value;
    }
    return seed;
  });
  const [padField, setPadField] = useState<Field | null>(null);
  const [padValue, setPadValue] = useState<string | null>(null);
  // Set when the pad was opened by "Fill all my initials": applying fills every empty box.
  const [fillAll, setFillAll] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const scroller = useRef<HTMLDivElement>(null);
  const width = useElementWidth(scroller);
  const [zoom, setZoom] = useState(1);
  const fieldEls = useRef(new Map<string, HTMLElement>());
  const finishButton = useRef<HTMLButtonElement>(null);
  // The field the guide is on: the one last focused, by the guide or by the signer.
  const [current, setCurrent] = useState<string | null>(null);
  const currentRef = useRef<string | null>(null);
  const [started, setStarted] = useState(false);

  const required = fields.filter((f) => f.required);
  const done = required.filter((f) => hasValue(f, values[f.id])).length;
  const pending = required.length - done;
  const optionalLeft = fields.some(
    (f) => !f.required && f.type !== 'date_signed' && !hasValue(f, values[f.id]),
  );
  const currentField = fields.find((f) => f.id === current) ?? null;
  const currentNeedsPad =
    currentField !== null &&
    (currentField.type === 'signature' || currentField.type === 'initials') &&
    !hasValue(currentField, values[currentField.id]);
  // What the one guide button does: Start, then Sign or Initial on a signature box, else Next.
  const guide: 'start' | 'sign' | 'next' | 'optional' | null =
    pending === 0
      ? optionalLeft
        ? 'optional'
        : null
      : !started
        ? 'start'
        : currentNeedsPad
          ? 'sign'
          : 'next';

  const setValue = (fieldId: string, value: string) =>
    setValues((prev) => ({ ...prev, [fieldId]: value }));

  const markCurrent = (fieldId: string) => {
    currentRef.current = fieldId;
    setCurrent(fieldId);
    setStarted(true);
  };

  const focusField = (fieldId: string) => {
    const el = fieldEls.current.get(fieldId);
    if (!el) return;
    el.scrollIntoView?.({
      block: 'center',
      inline: 'center',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
    el.focus({ preventScroll: true });
    markCurrent(fieldId);
  };

  /** The fields after `from` in reading order, wrapping round to it. */
  const fieldsAfter = (from: string | null) => {
    const start = fields.findIndex((f) => f.id === from);
    return [...fields.slice(start + 1), ...fields.slice(0, start + 1)];
  };

  const goToNextField = () => {
    const ordered = fieldsAfter(currentRef.current);
    const next =
      ordered.find((f) => f.required && !hasValue(f, values[f.id])) ??
      ordered.find((f) => !hasValue(f, values[f.id]) && f.type !== 'date_signed');
    setStarted(true);
    if (next) focusField(next.id);
    else finishButton.current?.focus();
  };

  /**
   * Moves on by itself once a field is done: to the next required field still empty in
   * `filled`, or to Finish when none is left. It waits a tick so a closing dialog can hand
   * focus back first.
   */
  const advance = (filled: FieldValues, from: string) => {
    const next = fieldsAfter(from).find((f) => f.required && !hasValue(f, filled[f.id]));
    setStarted(true);
    setTimeout(() => {
      if (next) focusField(next.id);
      else finishButton.current?.focus();
    }, 0);
  };

  const openPad = (field: Field) => {
    const type = field.type as Adoptable;
    const reuse = adopted[type];
    if (!hasValue(field, values[field.id]) && reuse) {
      setValue(field.id, reuse);
      advance({ ...values, [field.id]: reuse }, field.id);
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
      const field = padField;
      const type = field.type as Adoptable;
      const before = adopted[type];
      const next = { ...values, [field.id]: padValue };
      for (const f of fields) {
        if (f.type !== type || f.id === field.id) continue;
        const empty = !hasValue(f, next[f.id]);
        // "Fill all my initials" fills the empty boxes; a redrawn signature replaces the
        // adopted one wherever it was used, so the document carries one signature.
        if ((fillAll && type === 'initials' && empty) || (before && next[f.id] === before)) {
          next[f.id] = padValue;
        }
      }
      setValues(next);
      setAdopted((prev) => ({ ...prev, [type]: padValue }));
      closePad();
      advance(next, field.id);
      return;
    } else {
      setValues((prev) => {
        const next = { ...prev };
        delete next[padField.id];
        return next;
      });
    }
    closePad();
  };

  const submit = async (confirmed = false) => {
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
    if (confirmBeforeFinish && !confirmed) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
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

  const renderField = (field: Field, { scale, page }: PageContext) => {
    const value = values[field.id];
    const exact = pointsToPixels(field.rect, scale);
    // An empty signature box drawn at phone width can be a few millimetres tall. Until it is
    // signed it is shown at a size a finger can hit, grown about its own middle.
    const box =
      (field.type === 'signature' || field.type === 'initials') && !hasValue(field, value)
        ? growBox(exact, field.type === 'signature' ? 96 : 64, 36, {
            width: page.width * scale,
            height: page.height * scale,
          })
        : exact;
    const status = fieldStatus(field, value, showErrors);
    const typeLabel = field.label || labels.fieldTypes[field.type];
    const name = `${typeLabel}, ${field.required ? labels.required : labels.optional}`;
    const style = {
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      '--cvs-field-font': `${Math.max(10, Math.min(box.height * 0.62, 28))}px`,
      '--cvs-field-room': `${Math.max(0, page.width * scale - box.left)}px`,
    } as CSSProperties;
    const common = {
      'data-state': status,
      'data-required': field.required || undefined,
      'data-type': field.type,
      'data-current': (started && current === field.id) || undefined,
      'data-cvs-field': field.id,
      onFocus: () => markCurrent(field.id),
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
        enterKeyHint={pending > (hasValue(field, value) ? 0 : 1) ? 'next' : 'done'}
        onChange={(e) => setValue(field.id, e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          advance(values, field.id);
        }}
        {...common}
      />
    );
  };

  const renderOverlay = (ctx: PageContext) => {
    const onPage = fields.filter(
      (f) => f.documentId === ctx.documentId && f.page === ctx.pageIndex,
    );
    const flagged = onPage.find(
      (f) => started && f.id === current && !hasValue(f, values[f.id]) && f.type !== 'date_signed',
    );
    const at = flagged && pointsToPixels(flagged.rect, ctx.scale);
    const boxes = esignBoxes.filter(
      (f) => f.documentId === ctx.documentId && f.page === ctx.pageIndex,
    );
    return (
      <>
        {boxes.map((f) => {
          const box = pointsToPixels(f.rect, ctx.scale);
          return (
            <div
              key={f.id}
              className="cvs-field cvs-field--esign"
              data-type="aadhaar"
              role="note"
              aria-label={`${labels.aadhaarBox}: ${labels.aadhaarBoxNote}`}
              style={
                {
                  left: box.left,
                  top: box.top,
                  width: box.width,
                  height: box.height,
                  '--cvs-field-font': `${Math.max(9, Math.min(box.height * 0.3, 15))}px`,
                } as CSSProperties
              }
            >
              <span className="cvs-esign-title">{labels.aadhaarBox}</span>
              <span className="cvs-esign-note">{labels.aadhaarBoxNote}</span>
            </div>
          );
        })}
        {onPage.map((f) => renderField(f, ctx))}
        {flagged && at && (
          <>
            <span
              className="cvs-guide-flag"
              aria-hidden="true"
              data-below={at.top < 34 || undefined}
              style={{ left: at.left, top: at.top < 34 ? at.top + at.height : at.top }}
            >
              {labels.guideFlag(flagged.type)}
            </span>
            {at.left > 40 && (
              <span
                className="cvs-guide-tab"
                aria-hidden="true"
                data-wide={at.left > 96 || undefined}
                style={{ top: at.top + at.height / 2 }}
              >
                <span className="cvs-guide-tab-text">{labels.guideTab}</span>
              </span>
            )}
          </>
        )}
      </>
    );
  };

  const padAspect = padField
    ? Math.min(4, Math.max(1, padField.rect.width / Math.max(1, padField.rect.height)))
    : 3;

  return (
    <div className={['cvs-root', 'cvs-signing', className].filter(Boolean).join(' ')}>
      <div className="cvs-viewer-bar">
        <ZoomControls zoom={zoom} onZoom={setZoom} labels={labels} />
      </div>
      {/* The one place the pages scroll, up and down and, zoomed in, sideways. */}
      <div
        ref={scroller}
        className="cvs-scroller"
        role="region"
        aria-label={labels.documentRegion}
        tabIndex={0}
      >
        <DocumentPages
          documents={documents}
          states={states}
          containerWidth={width}
          zoom={zoom}
          labels={labels}
          renderOverlay={renderOverlay}
        />
      </div>

      <div
        className="cvs-action-bar"
        role="group"
        aria-label={labels.actions}
        data-pending={pending > 0 || undefined}
      >
        <div className="cvs-progress-block" data-done={pending === 0 || undefined}>
          <p className="cvs-progress" id={`${id}-progress`} aria-live="polite">
            {labels.progress(done, required.length)}
          </p>
          {pending === 0 && required.length > 0 && (
            <p className="cvs-progress-done">{labels.allDone}</p>
          )}
          {required.length > 0 && (
            <div className="cvs-progress-track" aria-hidden="true">
              <span style={{ width: `${(done / required.length) * 100}%` }} />
            </div>
          )}
        </div>
        <div className="cvs-action-buttons">
          {onDecline && (
            <button
              type="button"
              className="cvs-button cvs-button--ghost cvs-action-decline"
              onClick={() => setDeclining(true)}
              disabled={busy}
            >
              {labels.decline}
            </button>
          )}
          {initialsCount > 1 && emptyInitials.length > 0 && (
            <button
              type="button"
              className="cvs-button cvs-action-fill"
              onClick={fillAllInitials}
              disabled={busy}
            >
              {labels.fillInitials(emptyInitials.length)}
            </button>
          )}
          {guide && (
            <button
              type="button"
              className={`cvs-button cvs-action-guide${guide === 'optional' ? '' : ' cvs-button--primary'}`}
              data-guide={guide}
              onClick={() => {
                if (guide === 'sign' && currentField) openPad(currentField);
                else goToNextField();
              }}
              disabled={busy}
            >
              {guide === 'start'
                ? labels.start
                : guide === 'optional'
                  ? labels.nextField
                  : guide === 'sign' && currentField
                    ? currentField.type === 'initials'
                      ? labels.initialHere
                      : labels.signHere
                    : labels.next}
            </button>
          )}
          <button
            ref={finishButton}
            type="button"
            className={`cvs-button cvs-action-finish${pending === 0 ? ' cvs-button--primary' : ''}`}
            onClick={() => void submit()}
            disabled={busy}
            aria-describedby={`${id}-progress`}
          >
            {busy ? labels.submitting : labels.finish}
          </button>
        </div>
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
          {fields.filter((f) => f.type === padField.type).length > 1 && (
            <p className="cvs-hint cvs-reuse-note">
              {padField.type === 'initials' ? labels.reuseInitials : labels.reuseSignature}
            </p>
          )}
          {labels.adoptTerms && <p className="cvs-adopt-terms">{labels.adoptTerms}</p>}
        </Dialog>
      )}

      {confirming && (
        <Dialog
          title={labels.confirmTitle}
          onClose={() => setConfirming(false)}
          footer={
            <>
              <button
                type="button"
                className="cvs-button cvs-button--ghost"
                onClick={() => setConfirming(false)}
              >
                {labels.cancel}
              </button>
              <button
                type="button"
                className="cvs-button cvs-button--primary"
                onClick={() => void submit(true)}
                disabled={busy}
              >
                {labels.confirmFinish}
              </button>
            </>
          }
        >
          <p className="cvs-confirm-body">
            {labels.confirmBody(fields.filter((f) => hasValue(f, values[f.id])).length)}
          </p>
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
          {labels.declineReasons.length > 0 && (
            <div className="cvs-reasons">
              {labels.declineReasons.map((text) => (
                <button
                  key={text}
                  type="button"
                  className="cvs-reason"
                  aria-pressed={reason === text}
                  onClick={() => setReason(text)}
                >
                  {text}
                </button>
              ))}
            </div>
          )}
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

interface PixelBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** `box` grown about its middle to at least the given size, kept on its page. */
function growBox(
  box: PixelBox,
  minWidth: number,
  minHeight: number,
  page: { width: number; height: number },
): PixelBox {
  const width = Math.min(Math.max(box.width, minWidth), page.width);
  const height = Math.min(Math.max(box.height, minHeight), page.height);
  const left = Math.min(Math.max(0, box.left - (width - box.width) / 2), page.width - width);
  const top = Math.min(Math.max(0, box.top - (height - box.height) / 2), page.height - height);
  return { left, top, width, height };
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

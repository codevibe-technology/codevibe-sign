import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Field, FieldType, Recipient } from '@codevibe_technology/sign-core';
import { clientToPoints, pointsToPixels, type PageSize } from '../geometry';
import { defaultFieldTypeLabels, mergeLabels, recipientColorIndex } from '../labels';
import type { LoadPdfOptions } from '../pdf/pdfjs';
import type { TextItem, ViewerDocument } from '../pdf/types';
import { usePdfSources } from '../pdf/usePdfSources';
import {
  DocumentPages,
  ZoomControls,
  defaultViewerLabels,
  useElementWidth,
  type PageContext,
  type ViewerLabels,
} from '../viewer/DocumentPages';
import { pagesForChoice, type RepeatChoice } from './multipage';
import { fieldsOverText } from './overlap';
import { isArrowKey, type Size } from './placement';
import { fieldsFromTags, findTags, type FieldTag } from './tags';
import { newFieldId, useFieldPlacement, type FieldPlacementState } from './useFieldPlacement';

export interface FieldPlacerLabels extends ViewerLabels {
  fieldTypes: Record<FieldType, string>;
  palette: string;
  paletteHint: string;
  recipient: string;
  noRecipients: string;
  field: (type: string, recipient: string, page: number) => string;
  keyboardHint: string;
  selectedField: string;
  assignedTo: string;
  required: string;
  deleteField: string;
  resize: string;
  repeatOn: string;
  repeatChoices: Record<RepeatChoice, string>;
  pagesPlaceholder: string;
  applyRepeat: string;
  repeated: (count: number) => string;
  groupBadge: (pages: number) => string;
  applyToGroup: (count: number) => string;
  deleteThis: string;
  deleteGroup: (count: number) => string;
  presets: string;
  initialsEveryPage: string;
  signatureLastPage: string;
  placeFromTags: (count: number) => string;
  tagsPlaced: (placed: number, unmatched: number) => string;
  fieldCount: (count: number) => string;
  selectHint: string;
  overText: string;
  overTextNote: (count: number) => string;
}

export const defaultFieldPlacerLabels: FieldPlacerLabels = {
  ...defaultViewerLabels,
  fieldTypes: defaultFieldTypeLabels,
  palette: 'Fields',
  paletteHint: 'Drag a field onto a page, or press Enter to add it to the page in view.',
  recipient: 'Signers',
  noRecipients: 'Add a recipient to start placing fields.',
  field: (type, recipient, page) => `${type} for ${recipient}, page ${page}`,
  keyboardHint:
    'Arrow keys move the field, Shift moves it 10 points. Alt with arrow keys resizes it. Delete removes it.',
  selectedField: 'Selected field',
  assignedTo: 'Assigned to',
  required: 'Required',
  deleteField: 'Delete field',
  resize: 'Resize',
  repeatOn: 'Repeat on pages',
  repeatChoices: {
    this: 'This page only',
    all: 'All pages',
    'except-first': 'Every page except the first',
    last: 'Last page',
    custom: 'Pages…',
  },
  pagesPlaceholder: 'For example 1, 3, 5-7',
  applyRepeat: 'Repeat',
  repeated: (count) =>
    count === 0
      ? 'Those pages already have this field.'
      : count === 1
        ? 'Added to 1 more page.'
        : `Added to ${count} more pages.`,
  groupBadge: (pages) => `×${pages} pages`,
  applyToGroup: (count) => `Apply to all ${count} in group`,
  deleteThis: 'Delete this one',
  deleteGroup: (count) => `Delete all ${count}`,
  presets: 'Quick add',
  initialsEveryPage: 'Initials on every page',
  signatureLastPage: 'Signature on last page',
  placeFromTags: (count) => `Place fields from tags (found ${count})`,
  tagsPlaced: (placed, unmatched) =>
    unmatched === 0
      ? `Placed ${placed} ${placed === 1 ? 'field' : 'fields'} from tags.`
      : `Placed ${placed}; ${unmatched} ${unmatched === 1 ? 'tag names' : 'tags name'} a recipient number nobody has.`,
  fieldCount: (count) =>
    count === 0 ? 'No fields' : `${count} ${count === 1 ? 'field' : 'fields'}`,
  selectHint:
    'Pick a signer, then drag a field onto the page. Click a placed field to change it here.',
  overText: 'Over text',
  overTextNote: (count) =>
    count === 1
      ? 'A signature or initials field covers page text. The drawn signature will hide it; move the field to a blank space if you can.'
      : `${count} signature or initials fields cover page text. The drawn signatures will hide it; move them to blank space if you can.`,
};

const FIELD_TYPES: FieldType[] = [
  'signature',
  'initials',
  'date_signed',
  'name',
  'text',
  'checkbox',
];

export interface FieldPlacerProps {
  documents: ViewerDocument[];
  /** Recipients that can be given fields; viewers are left out of the picker. */
  recipients: Recipient[];
  fields?: Field[];
  defaultFields?: Field[];
  onChange?: (fields: Field[]) => void;
  fieldTypes?: FieldType[];
  fieldSizes?: Partial<Record<FieldType, Size>>;
  snapThreshold?: number;
  createId?: () => string;
  pdf?: LoadPdfOptions;
  labels?: Partial<FieldPlacerLabels>;
  className?: string;
}

interface Drag {
  pointerId: number;
  fieldId: string;
  kind: 'move' | 'resize';
  startX: number;
  startY: number;
  rect: Field['rect'];
  scale: number;
}

interface PaletteDrag {
  pointerId: number;
  type: FieldType;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
}

function pageElementAt(x: number, y: number): HTMLElement | null {
  const stack =
    typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(x, y) : [];
  for (const el of stack) {
    const page = el.closest<HTMLElement>('[data-cvs-page]');
    if (page) return page;
  }
  return null;
}

export function FieldPlacer({
  documents,
  recipients,
  fields,
  defaultFields,
  onChange,
  fieldTypes = FIELD_TYPES,
  fieldSizes,
  snapThreshold,
  createId,
  pdf,
  labels: labelOverrides,
  className,
}: FieldPlacerProps) {
  const labels = mergeLabels(defaultFieldPlacerLabels, labelOverrides);
  const states = usePdfSources(documents, pdf);
  const pageSizes = useMemo(() => {
    const sizes: Record<string, PageSize[]> = {};
    for (const doc of documents) sizes[doc.id] = states[doc.id]?.source?.pages ?? [];
    return sizes;
  }, [documents, states]);

  const signers = useMemo(() => recipients.filter((r) => r.role !== 'viewer'), [recipients]);
  const placement = useFieldPlacement({
    fields,
    defaultFields,
    onChange,
    pageSizes,
    recipients: signers,
    fieldSizes,
    snapThreshold,
    createId,
  });

  const id = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const width = useElementWidth(scroller);
  const [zoom, setZoom] = useState(1);
  const drag = useRef<Drag | null>(null);
  const [paletteDrag, setPaletteDrag] = useState<PaletteDrag | null>(null);
  const paletteDragWasMove = useRef(false);

  const recipientName = (rid: string) => signers.find((r) => r.id === rid)?.name ?? '';

  const [repeatChoice, setRepeatChoice] = useState<RepeatChoice>('all');
  const [repeatPages, setRepeatPages] = useState('');
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [tags, setTags] = useState<Record<string, FieldTag[]>>({});
  const [pageText, setPageText] = useState<Record<string, TextItem[][]>>({});
  const [tagsUsed, setTagsUsed] = useState(false);

  // Reads each loaded document's text once: for {{type:n}} tags, and to spot fields over text.
  useEffect(() => {
    let cancelled = false;
    for (const doc of documents) {
      const source = states[doc.id]?.source;
      if (!source?.textItems || tags[doc.id]) continue;
      const read = source.textItems;
      void Promise.all(
        source.pages.map((_, page) => read(page).catch(() => [] as TextItem[])),
      ).then((pages) => {
        if (cancelled) return;
        setPageText((prev) => ({ ...prev, [doc.id]: pages }));
        setTags((prev) => ({
          ...prev,
          [doc.id]: pages.flatMap((items, page) => findTags(items, page)),
        }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [documents, states, tags]);

  const overText = useMemo(
    () => fieldsOverText(placement.fields, (documentId, page) => pageText[documentId]?.[page]),
    [placement.fields, pageText],
  );

  const tagCount = Object.values(tags).reduce((n, list) => n + list.length, 0);

  const placeFromTags = () => {
    const ordered = [...signers].sort((a, b) => a.order - b.order);
    let placed = 0;
    let unmatched = 0;
    const added = Object.entries(tags).flatMap(([documentId, list]) => {
      const result = fieldsFromTags(list, {
        documentId,
        recipients: ordered,
        pageSizes: pageSizes[documentId] ?? [],
        createId: createId ?? newFieldId,
        ...(fieldSizes ? { sizes: fieldSizes } : {}),
      });
      placed += result.fields.length;
      unmatched += result.unmatched.length;
      return result.fields;
    });
    placement.addFields(added);
    setTagsUsed(true);
    setNotice({ text: labels.tagsPlaced(placed, unmatched), error: unmatched > 0 });
  };

  const repeatSelected = (field: Field) => {
    const count = pageSizes[field.documentId]?.length ?? 0;
    const pages = pagesForChoice(repeatChoice, count, field.page, repeatPages);
    if ('error' in pages) {
      setNotice({ text: pages.error, error: true });
      return;
    }
    setNotice({ text: labels.repeated(placement.repeatField(field.id, pages.pages)) });
  };

  const pageInView = (): { documentId: string; page: number } | null => {
    const container = scroller.current;
    const pages = container?.querySelectorAll<HTMLElement>('[data-cvs-page]') ?? [];
    const view = container?.getBoundingClientRect();
    let best: { documentId: string; page: number; visible: number } | null = null;
    for (const el of pages) {
      const box = el.getBoundingClientRect();
      const visible = view
        ? Math.max(0, Math.min(box.bottom, view.bottom) - Math.max(box.top, view.top))
        : 0;
      if (!best || visible > best.visible) {
        best = {
          documentId: el.dataset.cvsDocument ?? '',
          page: Number(el.dataset.cvsPage),
          visible,
        };
      }
    }
    return best;
  };

  const addToPageInView = (type: FieldType) => {
    const target = pageInView();
    if (target) placement.addField(type, target.documentId, target.page);
  };

  const onPalettePointerDown = (e: ReactPointerEvent<HTMLButtonElement>, type: FieldType) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setPaletteDrag({
      pointerId: e.pointerId,
      type,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      moved: false,
    });
  };

  const onPalettePointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    setPaletteDrag((d) => {
      if (!d || d.pointerId !== e.pointerId) return d;
      const moved = d.moved || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 4;
      return { ...d, x: e.clientX, y: e.clientY, moved };
    });
  };

  const onPalettePointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = paletteDrag;
    setPaletteDrag(null);
    paletteDragWasMove.current = Boolean(d?.moved);
    if (!d || d.pointerId !== e.pointerId || !d.moved) return;
    const pageEl = pageElementAt(e.clientX, e.clientY);
    const documentId = pageEl?.dataset.cvsDocument;
    const pageIndex = Number(pageEl?.dataset.cvsPage);
    const size = documentId ? placement.pageSize(documentId, pageIndex) : undefined;
    if (!pageEl || !documentId || !size) return;
    const box = pageEl.getBoundingClientRect();
    const scale = box.width / size.width;
    placement.addField(
      d.type,
      documentId,
      pageIndex,
      clientToPoints(e.clientX, e.clientY, box, scale),
    );
  };

  const startDrag = (
    e: ReactPointerEvent<HTMLElement>,
    field: Field,
    kind: Drag['kind'],
    scale: number,
  ) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    placement.select(field.id);
    drag.current = {
      pointerId: e.pointerId,
      fieldId: field.id,
      kind,
      startX: e.clientX,
      startY: e.clientY,
      rect: field.rect,
      scale,
    };
  };

  const onDragMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = (e.clientX - d.startX) / d.scale;
    const dy = (e.clientY - d.startY) / d.scale;
    if (d.kind === 'move') {
      placement.moveField(d.fieldId, { ...d.rect, x: d.rect.x + dx, y: d.rect.y + dy });
    } else {
      placement.resizeField(d.fieldId, d.rect.width + dx, d.rect.height + dy);
    }
  };

  const endDrag = (e: ReactPointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId === e.pointerId) drag.current = null;
  };

  const onFieldKey = (e: KeyboardEvent<HTMLElement>, field: Field) => {
    if (isArrowKey(e.key)) {
      e.preventDefault();
      placement.nudgeField(field.id, e.key, { large: e.shiftKey, resize: e.altKey });
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      placement.removeField(field.id);
    } else if (e.key === 'Escape') {
      placement.select(null);
      e.currentTarget.blur();
    }
  };

  const renderOverlay = ({ documentId, pageIndex, scale }: PageContext) =>
    placement.fields
      .filter((f) => f.documentId === documentId && f.page === pageIndex)
      .map((field) => {
        const box = pointsToPixels(field.rect, scale);
        const selected = placement.selectedId === field.id;
        const color = recipientColorIndex(signers, field.recipientId);
        return (
          <div
            key={field.id}
            className="cvs-placed"
            data-type={field.type}
            data-selected={selected || undefined}
            data-over-text={overText.has(field.id) || undefined}
            data-cvs-color={color}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            aria-label={[
              labels.field(
                labels.fieldTypes[field.type],
                recipientName(field.recipientId),
                field.page + 1,
              ),
              overText.has(field.id) ? labels.overText : '',
            ]
              .filter(Boolean)
              .join(', ')}
            aria-describedby={`${id}-keys`}
            style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
            onPointerDown={(e) => startDrag(e, field, 'move', scale)}
            onPointerMove={onDragMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onFocus={() => placement.select(field.id)}
            onKeyDown={(e) => onFieldKey(e, field)}
          >
            <span className="cvs-placed-label">
              {field.label || labels.fieldTypes[field.type]}
              {field.required && <span aria-hidden="true"> *</span>}
              {placement.groupOf(field.id).length > 1 && (
                <span className="cvs-placed-badge">
                  {labels.groupBadge(placement.groupOf(field.id).length)}
                </span>
              )}
              {overText.has(field.id) && (
                <span className="cvs-placed-badge cvs-placed-warning">{labels.overText}</span>
              )}
            </span>
            <span
              className="cvs-placed-resize"
              aria-hidden="true"
              title={labels.resize}
              onPointerDown={(e) => startDrag(e, field, 'resize', scale)}
              onPointerMove={onDragMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            />
          </div>
        );
      });

  const selected = placement.selected;

  return (
    <div className={['cvs-root', 'cvs-placer', className].filter(Boolean).join(' ')}>
      <aside className="cvs-placer-panel cvs-placer-tools" aria-label={labels.palette}>
        <h3 className="cvs-panel-title" id={`${id}-palette`}>
          {labels.palette}
        </h3>
        <div className="cvs-palette" role="group" aria-labelledby={`${id}-palette`}>
          {fieldTypes.map((type) => (
            <button
              key={type}
              type="button"
              className="cvs-palette-item"
              data-type={type}
              data-cvs-color={recipientColorIndex(signers, placement.recipientId ?? '')}
              disabled={signers.length === 0}
              aria-describedby={`${id}-palette-hint`}
              onPointerDown={(e) => onPalettePointerDown(e, type)}
              onPointerMove={onPalettePointerMove}
              onPointerUp={onPalettePointerUp}
              onPointerCancel={() => setPaletteDrag(null)}
              onClick={() => {
                // A click that ended a drag has already placed the field.
                if (!paletteDragWasMove.current) addToPageInView(type);
                paletteDragWasMove.current = false;
              }}
            >
              <FieldTypeIcon type={type} />
              <span className="cvs-palette-label">{labels.fieldTypes[type]}</span>
            </button>
          ))}
        </div>
        <p className="cvs-hint" id={`${id}-palette-hint`}>
          {labels.paletteHint}
        </p>

        <h3 className="cvs-panel-title">{labels.presets}</h3>
        <div className="cvs-presets" role="group" aria-label={labels.presets}>
          <button
            type="button"
            className="cvs-button cvs-button--quiet"
            disabled={signers.length === 0}
            onClick={() => placement.addInitialsEveryPage()}
          >
            {labels.initialsEveryPage}
          </button>
          <button
            type="button"
            className="cvs-button cvs-button--quiet"
            disabled={signers.length === 0}
            onClick={() => placement.addSignatureLastPage()}
          >
            {labels.signatureLastPage}
          </button>
          {tagCount > 0 && !tagsUsed && (
            <button
              type="button"
              className="cvs-button cvs-button--primary"
              disabled={signers.length === 0}
              onClick={placeFromTags}
            >
              {labels.placeFromTags(tagCount)}
            </button>
          )}
        </div>
        {notice && (
          <p className={notice.error ? 'cvs-error' : 'cvs-hint'} role="status">
            {notice.text}
          </p>
        )}
      </aside>

      <div className="cvs-viewer">
        <div className="cvs-viewer-bar">
          <ZoomControls zoom={zoom} onZoom={setZoom} labels={labels} />
        </div>
        <div
          ref={scroller}
          className="cvs-scroller"
          tabIndex={0}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) placement.select(null);
          }}
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
      </div>

      <aside className="cvs-placer-panel cvs-placer-side" aria-label={labels.recipient}>
        {signers.length === 0 ? (
          <p className="cvs-hint">{labels.noRecipients}</p>
        ) : (
          <RecipientPicker
            placement={placement}
            recipients={signers}
            label={labels.recipient}
            countLabel={labels.fieldCount}
          />
        )}

        {overText.size > 0 && (
          <p className="cvs-warning" role="status">
            {labels.overTextNote(overText.size)}
          </p>
        )}

        {selected ? (
          <div className="cvs-inspector" role="group" aria-label={labels.selectedField}>
            <h3 className="cvs-panel-title">{labels.selectedField}</h3>
            <label className="cvs-label" htmlFor={`${id}-assign`}>
              {labels.assignedTo}
            </label>
            <select
              id={`${id}-assign`}
              className="cvs-input"
              value={selected.recipientId}
              onChange={(e) => placement.updateField(selected.id, { recipientId: e.target.value })}
            >
              {signers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <label className="cvs-check">
              <input
                type="checkbox"
                checked={selected.required}
                onChange={(e) => placement.updateField(selected.id, { required: e.target.checked })}
              />
              {labels.required}
            </label>
            <label className="cvs-label" htmlFor={`${id}-repeat`}>
              {labels.repeatOn}
            </label>
            <div className="cvs-row">
              <select
                id={`${id}-repeat`}
                className="cvs-input"
                value={repeatChoice}
                onChange={(e) => setRepeatChoice(e.target.value as RepeatChoice)}
              >
                {(Object.keys(labels.repeatChoices) as RepeatChoice[]).map((choice) => (
                  <option key={choice} value={choice}>
                    {labels.repeatChoices[choice]}
                  </option>
                ))}
              </select>
              <button type="button" className="cvs-button" onClick={() => repeatSelected(selected)}>
                {labels.applyRepeat}
              </button>
            </div>
            {repeatChoice === 'custom' && (
              <input
                className="cvs-input"
                aria-label={labels.repeatChoices.custom}
                placeholder={labels.pagesPlaceholder}
                value={repeatPages}
                onChange={(e) => setRepeatPages(e.target.value)}
              />
            )}
            <div className="cvs-inspector-actions">
              {placement.groupOf(selected.id).length > 1 ? (
                <>
                  <button
                    type="button"
                    className="cvs-button"
                    onClick={() => placement.applyToGroup(selected.id)}
                  >
                    {labels.applyToGroup(placement.groupOf(selected.id).length)}
                  </button>
                  <button
                    type="button"
                    className="cvs-button cvs-button--danger-quiet"
                    onClick={() => placement.removeField(selected.id)}
                  >
                    {labels.deleteThis}
                  </button>
                  <button
                    type="button"
                    className="cvs-button cvs-button--danger-quiet"
                    onClick={() => placement.removeGroup(selected.id)}
                  >
                    {labels.deleteGroup(placement.groupOf(selected.id).length)}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="cvs-button cvs-button--danger-quiet"
                  onClick={() => placement.removeField(selected.id)}
                >
                  {labels.deleteField}
                </button>
              )}
            </div>
          </div>
        ) : (
          signers.length > 0 && <p className="cvs-hint cvs-side-empty">{labels.selectHint}</p>
        )}
        <p className="cvs-hint cvs-keys" id={`${id}-keys`}>
          {labels.keyboardHint}
        </p>
      </aside>

      {paletteDrag?.moved && (
        <div
          className="cvs-drag-ghost"
          data-cvs-color={recipientColorIndex(signers, placement.recipientId ?? '')}
          aria-hidden="true"
          style={{ left: paletteDrag.x, top: paletteDrag.y } as CSSProperties}
        >
          {labels.fieldTypes[paletteDrag.type]}
        </div>
      )}
    </div>
  );
}

const ICON_PATHS: Record<FieldType, string> = {
  signature:
    'M3 17c3-5 5.2-7.5 6.6-7.5 2.1 0 .3 6.6 2.4 6.6 1.6 0 3-3 4.6-3 1.2 0 1.2 1.9 2.6 1.9M3 21h18',
  initials: 'M5 18V6l5 12V6M14 6h5M16.5 6v12M14 18h5',
  date_signed: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h3',
  name: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1.4-4 4.4-6 8-6s6.6 2 8 6',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  checkbox: 'M4 4h16v16H4zM8 12l3 3 5-6',
};

function FieldTypeIcon({ type }: { type: FieldType }) {
  return (
    <svg
      className="cvs-palette-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={ICON_PATHS[type]} />
    </svg>
  );
}

function RecipientPicker({
  placement,
  recipients,
  label,
  countLabel,
}: {
  placement: FieldPlacementState;
  recipients: Recipient[];
  label: string;
  countLabel: (count: number) => string;
}) {
  const id = useId();
  return (
    <div className="cvs-recipients" role="radiogroup" aria-labelledby={id}>
      <h3 className="cvs-panel-title" id={id}>
        {label}
      </h3>
      {recipients.map((r, index) => {
        const count = placement.fields.filter((f) => f.recipientId === r.id).length;
        return (
          <div
            key={r.id}
            className="cvs-recipient"
            data-cvs-color={index % 6}
            data-active={placement.recipientId === r.id || undefined}
          >
            <label className="cvs-recipient-main">
              <input
                type="radio"
                name={id}
                checked={placement.recipientId === r.id}
                onChange={() => placement.setRecipientId(r.id)}
              />
              <span className="cvs-recipient-dot" aria-hidden="true" />
              <span className="cvs-recipient-name">{r.name}</span>
            </label>
            <span
              className="cvs-recipient-count"
              data-empty={(count === 0 && r.role === 'signer') || undefined}
            >
              {countLabel(count)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

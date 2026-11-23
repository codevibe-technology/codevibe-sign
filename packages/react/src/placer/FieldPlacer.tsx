import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
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
import { choiceForPages, formatPageList, pagesForChoice, type RepeatChoice } from './multipage';
import { fieldsOverText } from './overlap';
import { defaultFieldSizes, isArrowKey, type Size } from './placement';
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
  /** Names the box for typed page numbers. */
  pagesLabel: string;
  pagesPlaceholder: string;
  /** Under the page numbers box; `page` is the selected field's own page, counted from 1. */
  pagesHint: (page: number) => string;
  applyRepeat: string;
  /** What a change of pages did: copies added and copies removed. */
  repeatChanged: (added: number, removed: number) => string;
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
  repeatOn: 'Show on pages',
  repeatChoices: {
    this: 'This page only',
    all: 'All pages',
    custom: 'Specific pages…',
  },
  pagesLabel: 'Page numbers',
  pagesPlaceholder: 'For example 1, 3, 5-7',
  pagesHint: (page) => `Page ${page}, where this field sits, is always included.`,
  applyRepeat: 'Apply',
  repeatChanged: (added, removed) => {
    const pages = (count: number) => (count === 1 ? '1 page' : `${count} pages`);
    if (added > 0 && removed > 0) {
      return `Added to ${pages(added)} and removed from ${pages(removed)}.`;
    }
    if (added > 0) return `Added to ${added === 1 ? '1 more page' : `${added} more pages`}.`;
    if (removed > 0)
      return `Removed from ${removed === 1 ? '1 other page' : `${removed} other pages`}.`;
    return 'Those pages already have this field.';
  },
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
  /** The field's size on screen at the current zoom, so the ghost shows what will land. */
  width: number;
  height: number;
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

  // Page numbers being typed for one field; until applied, the field's pages stay as they are.
  const [typedPages, setTypedPages] = useState<{ fieldId: string; text: string } | null>(null);
  const [repeatNotice, setRepeatNotice] = useState<{
    fieldId: string;
    text: string;
    error?: boolean;
  } | null>(null);
  const pagesInput = useRef<HTMLInputElement>(null);
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

  /** Applies a pages choice to the field straight away: there is no separate button to press. */
  const showOnPages = (field: Field, choice: RepeatChoice, text = '') => {
    const count = pageSizes[field.documentId]?.length ?? 0;
    const pages = pagesForChoice(choice, count, field.page, text);
    if ('error' in pages) {
      setRepeatNotice({ fieldId: field.id, text: pages.error, error: true });
      return;
    }
    const { added, removed } = placement.setFieldPages(field.id, pages.pages);
    setTypedPages(null);
    setRepeatNotice({ fieldId: field.id, text: labels.repeatChanged(added, removed) });
  };

  const chooseRepeat = (field: Field, choice: RepeatChoice) => {
    if (choice !== 'custom') {
      showOnPages(field, choice);
      return;
    }
    setRepeatNotice(null);
    setTypedPages({ fieldId: field.id, text: formatPageList(placement.pagesOf(field.id)) });
    // The box appears with this render; move to it so the numbers can be typed at once.
    setTimeout(() => pagesInput.current?.select(), 0);
  };

  /**
   * The page that fills most of the viewer, with the middle of the part of it on screen in
   * page points, so a field added by a click or Enter lands where the sender is looking.
   */
  const pageInView = (): {
    documentId: string;
    page: number;
    center?: { x: number; y: number };
    scale?: number;
  } | null => {
    const container = scroller.current;
    const pages = container?.querySelectorAll<HTMLElement>('[data-cvs-page]') ?? [];
    const view = container?.getBoundingClientRect();
    let best: { el: HTMLElement; box: DOMRect; visible: number } | null = null;
    for (const el of pages) {
      const box = el.getBoundingClientRect();
      const visible = view
        ? Math.max(0, Math.min(box.bottom, view.bottom) - Math.max(box.top, view.top))
        : 0;
      if (!best || visible > best.visible) best = { el, box, visible };
    }
    if (!best) return null;
    const documentId = best.el.dataset.cvsDocument ?? '';
    const page = Number(best.el.dataset.cvsPage);
    const size = placement.pageSize(documentId, page);
    if (!view || !size || best.visible <= 0 || best.box.width <= 0) return { documentId, page };
    const scale = best.box.width / size.width;
    const top = Math.max(best.box.top, view.top);
    const bottom = Math.min(best.box.bottom, view.bottom);
    const left = Math.max(best.box.left, view.left);
    const right = Math.min(best.box.right, view.right);
    return {
      documentId,
      page,
      scale,
      center: clientToPoints((left + right) / 2, (top + bottom) / 2, best.box, scale),
    };
  };

  const addToPageInView = (type: FieldType) => {
    const target = pageInView();
    if (!target) return;
    placement.addField(type, target.documentId, target.page, target.center, {
      avoidOverlap: true,
    });
  };

  const onPalettePointerDown = (e: ReactPointerEvent<HTMLButtonElement>, type: FieldType) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const size = fieldSizes?.[type] ?? defaultFieldSizes[type];
    const scale = pageInView()?.scale ?? 1;
    setPaletteDrag({
      pointerId: e.pointerId,
      type,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      moved: false,
      width: size.width * scale,
      height: size.height * scale,
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
        <p className={notice?.error ? 'cvs-error' : 'cvs-hint'} role="status">
          {notice?.text}
        </p>
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
            <RepeatControl
              id={id}
              labels={labels}
              pageCount={pageSizes[selected.documentId]?.length ?? 0}
              page={selected.page}
              pages={placement.pagesOf(selected.id)}
              typed={typedPages?.fieldId === selected.id ? typedPages.text : null}
              notice={repeatNotice?.fieldId === selected.id ? repeatNotice : null}
              inputRef={pagesInput}
              onChoose={(choice) => chooseRepeat(selected, choice)}
              onType={(text) => setTypedPages({ fieldId: selected.id, text })}
              onApply={(text) => showOnPages(selected, 'custom', text)}
            />
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
          style={
            {
              left: paletteDrag.x,
              top: paletteDrag.y,
              width: paletteDrag.width,
              height: paletteDrag.height,
            } as CSSProperties
          }
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

interface RepeatControlProps {
  id: string;
  labels: FieldPlacerLabels;
  pageCount: number;
  /** The selected field's own page, zero-based. */
  page: number;
  /** Pages the field and its copies are on now, zero-based. */
  pages: number[];
  /** Page numbers being typed, or null when the box is closed. */
  typed: string | null;
  notice: { text: string; error?: boolean } | null;
  inputRef: RefObject<HTMLInputElement | null>;
  onChoose: (choice: RepeatChoice) => void;
  onType: (text: string) => void;
  onApply: (text: string) => void;
}

/**
 * Which pages the selected field shows on. The list always reads what is true now: "This page
 * only" for a lone field, "All pages" once it is on every page, "Specific pages" with the
 * numbers otherwise. Picking a choice applies it; typed numbers apply on Enter or Apply.
 */
function RepeatControl({
  id,
  labels,
  pageCount,
  page,
  pages,
  typed,
  notice,
  inputRef,
  onChoose,
  onType,
  onApply,
}: RepeatControlProps) {
  if (pageCount < 2) return null;
  const current = choiceForPages(pages, pageCount);
  const choice: RepeatChoice = typed !== null ? 'custom' : current;
  const text = typed ?? formatPageList(pages);
  return (
    <div className="cvs-repeat">
      <label className="cvs-label" htmlFor={`${id}-repeat`}>
        {labels.repeatOn}
      </label>
      <select
        id={`${id}-repeat`}
        className="cvs-input"
        value={choice}
        onChange={(e) => onChoose(e.target.value as RepeatChoice)}
      >
        {(['this', 'all', 'custom'] as const).map((value) => (
          <option key={value} value={value}>
            {labels.repeatChoices[value]}
          </option>
        ))}
      </select>
      {choice === 'custom' && (
        <>
          <div className="cvs-row">
            <input
              ref={inputRef}
              className="cvs-input"
              inputMode="numeric"
              aria-label={labels.pagesLabel}
              aria-describedby={`${id}-repeat-hint`}
              aria-invalid={notice?.error || undefined}
              placeholder={labels.pagesPlaceholder}
              value={text}
              onChange={(e) => onType(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                onApply(text);
              }}
            />
            <button type="button" className="cvs-button" onClick={() => onApply(text)}>
              {labels.applyRepeat}
            </button>
          </div>
          <p className="cvs-hint" id={`${id}-repeat-hint`}>
            {labels.pagesHint(page + 1)}
          </p>
        </>
      )}
      <p className={notice?.error ? 'cvs-error' : 'cvs-hint'} role="status">
        {notice?.text}
      </p>
    </div>
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

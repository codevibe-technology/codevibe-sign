import {
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
import type { ViewerDocument } from '../pdf/types';
import { usePdfSources } from '../pdf/usePdfSources';
import {
  DocumentPages,
  ZoomControls,
  defaultViewerLabels,
  useElementWidth,
  type PageContext,
  type ViewerLabels,
} from '../viewer/DocumentPages';
import { isArrowKey, type Size } from './placement';
import { useFieldPlacement, type FieldPlacementState } from './useFieldPlacement';

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
}

export const defaultFieldPlacerLabels: FieldPlacerLabels = {
  ...defaultViewerLabels,
  fieldTypes: defaultFieldTypeLabels,
  palette: 'Fields',
  paletteHint: 'Drag a field onto a page, or press Enter to add it to the page in view.',
  recipient: 'Placing fields for',
  noRecipients: 'Add a recipient to start placing fields.',
  field: (type, recipient, page) => `${type} for ${recipient}, page ${page}`,
  keyboardHint:
    'Arrow keys move the field, Shift moves it 10 points. Alt with arrow keys resizes it. Delete removes it.',
  selectedField: 'Selected field',
  assignedTo: 'Assigned to',
  required: 'Required',
  deleteField: 'Delete field',
  resize: 'Resize',
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
            data-cvs-color={color}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            aria-label={labels.field(
              labels.fieldTypes[field.type],
              recipientName(field.recipientId),
              field.page + 1,
            )}
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
      <aside className="cvs-placer-panel" aria-label={labels.palette}>
        {signers.length === 0 ? (
          <p className="cvs-hint">{labels.noRecipients}</p>
        ) : (
          <RecipientPicker placement={placement} recipients={signers} label={labels.recipient} />
        )}
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
              {labels.fieldTypes[type]}
            </button>
          ))}
        </div>
        <p className="cvs-hint" id={`${id}-palette-hint`}>
          {labels.paletteHint}
        </p>

        {selected && (
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
            <button
              type="button"
              className="cvs-button cvs-button--danger"
              onClick={() => placement.removeField(selected.id)}
            >
              {labels.deleteField}
            </button>
          </div>
        )}
        <p className="cvs-hint" id={`${id}-keys`}>
          {labels.keyboardHint}
        </p>
      </aside>

      <div className="cvs-viewer">
        <div className="cvs-viewer-bar">
          <ZoomControls zoom={zoom} onZoom={setZoom} labels={labels} />
        </div>
        <div
          ref={scroller}
          className="cvs-scroller"
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

function RecipientPicker({
  placement,
  recipients,
  label,
}: {
  placement: FieldPlacementState;
  recipients: Recipient[];
  label: string;
}) {
  const id = useId();
  return (
    <div className="cvs-recipients" role="radiogroup" aria-labelledby={id}>
      <h3 className="cvs-panel-title" id={id}>
        {label}
      </h3>
      {recipients.map((r, index) => (
        <label key={r.id} className="cvs-recipient" data-cvs-color={index % 6}>
          <input
            type="radio"
            name={id}
            checked={placement.recipientId === r.id}
            onChange={() => placement.setRecipientId(r.id)}
          />
          <span className="cvs-recipient-dot" aria-hidden="true" />
          {r.name}
        </label>
      ))}
    </div>
  );
}

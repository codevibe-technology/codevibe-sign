import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Field, FieldType, Rect, Recipient } from '@codevibe_technology/sign-core';
import { clampRect, clientToPoints, pointsToPixels, roundRect, type PageSize } from '../geometry';
import { defaultFieldTypeLabels, mergeLabels, recipientColorIndex } from '../labels';
import type { LoadPdfOptions } from '../pdf/pdfjs';
import type { TextItem, ViewerDocument } from '../pdf/types';
import { usePdfSources } from '../pdf/usePdfSources';
import {
  DocumentPages,
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  defaultViewerLabels,
  useElementWidth,
  viewerScale,
  type PageContext,
  type ViewerLabels,
} from '../viewer/DocumentPages';
import { PageImage } from '../viewer/PageImage';
import { alignRect, pasteCopies, resizeFromCorner, type Corner, type Guide } from './align';
import { Icon, fieldIcon, type IconName } from './icons';
import {
  formatPageList,
  pagesForChoice,
  signatureOnLastPage,
  type RepeatChoice,
} from './multipage';
import { fieldsOverText } from './overlap';
import { defaultFieldSizes, isArrowKey, type Size } from './placement';
import {
  FieldsSummary,
  Inspector,
  MultiInspector,
  RecipientSwitcher,
  type TrayPreset,
} from './PlacerPanels';
import { fieldsFromTags, findTags, type FieldTag } from './tags';
import { newFieldId, useFieldPlacement } from './useFieldPlacement';

export interface FieldPlacerLabels extends ViewerLabels {
  fieldTypes: Record<FieldType, string>;
  palette: string;
  paletteHint: string;
  /** Heads the recipient switcher: whose fields the tray adds. */
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
  /**
   * In place of the field tray while an Aadhaar eSign signer is picked: they get no fields,
   * because the eSign provider places their signature.
   */
  aadhaarHint: (name: string) => string;
  placeFromTags: (count: number) => string;
  tagsPlaced: (placed: number, unmatched: number) => string;
  fieldCount: (count: number) => string;
  selectHint: string;
  overText: string;
  overTextNote: (count: number) => string;
  /** Headings of the field tray's groups. */
  trayGroups: { signature: string; details: string; inputs: string };
  /** Text fields the tray offers ready-labelled. */
  trayPresets: Record<TrayPreset, string>;
  tools: string;
  undo: string;
  redo: string;
  copy: string;
  paste: string;
  duplicate: string;
  deleteSelected: string;
  zoom: string;
  fitPage: string;
  pages: string;
  goToPage: (page: number, fields: number) => string;
  properties: string;
  summary: string;
  summaryCounts: (required: number, optional: number) => string;
  noSignature: string;
  addSignatureFor: (name: string) => string;
  /** In the summary, for an Aadhaar eSign signer. */
  aadhaarSummary: string;
  showField: string;
  fieldLabel: string;
  fieldLabelHint: string;
  size: string;
  width: string;
  height: string;
  onPage: (page: number, recipient: string) => string;
  selectedCount: (count: number) => string;
  assignAll: string;
  mixed: string;
  alignLeft: string;
  alignTop: string;
  sameSize: string;
  deleteCount: (count: number) => string;
  shortcuts: string;
  shortcutList: [keys: string, action: string][];
  preview: string;
  previewing: (name: string) => string;
  stopPreview: string;
  previewSign: string;
  previewInitial: string;
  previewAadhaar: string;
}

export const defaultFieldPlacerLabels: FieldPlacerLabels = {
  ...defaultViewerLabels,
  fieldTypes: defaultFieldTypeLabels,
  palette: 'Fields',
  paletteHint: 'Drag a field onto a page, or click it to add it to the page in view.',
  recipient: 'Add fields for',
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
  aadhaarHint: (name) =>
    `${name} signs with Aadhaar eSign. The eSign provider places the signature where its workflow says, so you place no box and ${name} fills in nothing here.`,
  placeFromTags: (count) => `Place fields from tags (found ${count})`,
  tagsPlaced: (placed, unmatched) =>
    unmatched === 0
      ? `Placed ${placed} ${placed === 1 ? 'field' : 'fields'} from tags.`
      : `Placed ${placed}; ${unmatched} ${unmatched === 1 ? 'tag names' : 'tags name'} a recipient number nobody has.`,
  fieldCount: (count) =>
    count === 0 ? 'No fields' : `${count} ${count === 1 ? 'field' : 'fields'}`,
  selectHint: 'Click a field on the page to change who fills it, whether it is required and more.',
  overText: 'Over text',
  overTextNote: (count) =>
    count === 1
      ? 'A signature or initials field covers page text. The drawn signature will hide it; move the field to a blank space if you can.'
      : `${count} signature or initials fields cover page text. The drawn signatures will hide it; move them to blank space if you can.`,
  trayGroups: { signature: 'Signature', details: 'Signer details', inputs: 'Inputs' },
  trayPresets: { email: 'Email', company: 'Company', title: 'Title' },
  tools: 'Editing tools',
  undo: 'Undo',
  redo: 'Redo',
  copy: 'Copy',
  paste: 'Paste',
  duplicate: 'Duplicate',
  deleteSelected: 'Delete selected',
  zoom: 'Zoom',
  fitPage: 'Fit page',
  pages: 'Pages',
  goToPage: (page, fields) =>
    `Page ${page}${fields > 0 ? `, ${fields} ${fields === 1 ? 'field' : 'fields'}` : ''}`,
  properties: 'Field properties',
  summary: 'Fields summary',
  summaryCounts: (required, optional) => {
    if (required + optional === 0) return 'No fields yet';
    const parts = [`${required} required ${required === 1 ? 'field' : 'fields'}`];
    if (optional > 0) parts.push(`${optional} optional`);
    return parts.join(' · ');
  },
  noSignature: 'No signature field yet.',
  addSignatureFor: (name) => `Add a signature for ${name}`,
  aadhaarSummary: 'Aadhaar eSign: no fields. The eSign provider places the signature.',
  showField: 'Show it',
  fieldLabel: 'Label',
  fieldLabelHint: 'The name the signer sees on this field.',
  size: 'Size (points)',
  width: 'Width',
  height: 'Height',
  onPage: (page, recipient) => `Page ${page} · ${recipient}`,
  selectedCount: (count) => `${count} fields selected`,
  assignAll: 'Assign all to',
  mixed: 'Several people',
  alignLeft: 'Align left edges',
  alignTop: 'Align top edges',
  sameSize: 'Make the same size',
  deleteCount: (count) => `Delete ${count} fields`,
  shortcuts: 'Keyboard shortcuts',
  shortcutList: [
    ['Arrows', 'Move 1 point (Shift: 10)'],
    ['Alt + arrows', 'Resize'],
    ['Shift + click', 'Select several'],
    ['Ctrl/⌘ + C, V', 'Copy and paste'],
    ['Ctrl/⌘ + D', 'Duplicate'],
    ['Ctrl/⌘ + Z', 'Undo (Shift: redo)'],
    ['Delete', 'Remove'],
  ],
  preview: 'Preview as signer',
  previewing: (name) => `Previewing what ${name} sees`,
  stopPreview: 'Back to editing',
  previewSign: 'Sign',
  previewInitial: 'Initial',
  previewAadhaar: 'Aadhaar eSign',
};

interface TrayItem {
  type: FieldType;
  preset?: TrayPreset;
}

const TRAY: { group: keyof FieldPlacerLabels['trayGroups']; items: TrayItem[] }[] = [
  {
    group: 'signature',
    items: [{ type: 'signature' }, { type: 'initials' }, { type: 'date_signed' }],
  },
  {
    group: 'details',
    items: [
      { type: 'name' },
      { type: 'text', preset: 'email' },
      { type: 'text', preset: 'company' },
      { type: 'text', preset: 'title' },
    ],
  },
  { group: 'inputs', items: [{ type: 'text' }, { type: 'checkbox' }] },
];

const FIELD_TYPES: FieldType[] = [
  'signature',
  'initials',
  'date_signed',
  'name',
  'text',
  'checkbox',
  'aadhaar',
];

const PRESET_SIZE: Record<TrayPreset, Size> = {
  email: { width: 180, height: 22 },
  company: { width: 160, height: 22 },
  title: { width: 140, height: 22 },
};

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const HISTORY_LIMIT = 100;

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
  /**
   * Shows the pages as the chosen recipient will see them, with nothing to edit. Leave both
   * this and `onPreviewingChange` out and the placer offers its own Preview button.
   */
  previewing?: boolean;
  onPreviewingChange?: (previewing: boolean) => void;
}

interface Drag {
  pointerId: number;
  kind: 'move' | 'resize';
  corner: Corner;
  fieldId: string;
  startX: number;
  startY: number;
  /** Where each field being moved started, in points. */
  rects: Map<string, Rect>;
  scale: number;
  gesture: string;
}

interface PaletteDrag {
  pointerId: number;
  item: TrayItem;
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

const typing = (target: EventTarget) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

const cssEscape = (value: string) =>
  typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : value.replace(/["\\]/g, '\\$&');

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
  previewing: previewingProp,
  onPreviewingChange,
}: FieldPlacerProps) {
  const labels = mergeLabels(defaultFieldPlacerLabels, labelOverrides);
  const states = usePdfSources(documents, pdf);
  const pageSizes = useMemo(() => {
    const sizes: Record<string, PageSize[]> = {};
    for (const doc of documents) sizes[doc.id] = states[doc.id]?.source?.pages ?? [];
    return sizes;
  }, [documents, states]);

  const signers = useMemo(() => recipients.filter((r) => r.role !== 'viewer'), [recipients]);

  // Undo and redo: the fields before each change. A drag or a run of key presses is one step.
  const past = useRef<Field[][]>([]);
  const future = useRef<Field[][]>([]);
  const latest = useRef<Field[]>(fields ?? defaultFields ?? []);
  const gesture = useRef<string | null>(null);
  const lastStep = useRef<{ gesture: string | null; at: number }>({ gesture: null, at: 0 });
  const restoring = useRef(false);
  const [, setHistoryVersion] = useState(0);

  const record = (next: Field[]) => {
    if (!restoring.current) {
      const now = Date.now();
      const same =
        gesture.current !== null &&
        lastStep.current.gesture === gesture.current &&
        now - lastStep.current.at < 1500;
      if (!same) {
        past.current.push(latest.current);
        if (past.current.length > HISTORY_LIMIT) past.current.shift();
        future.current = [];
        setHistoryVersion((v) => v + 1);
      }
      lastStep.current = { gesture: gesture.current, at: now };
    }
    latest.current = next;
    onChange?.(next);
  };

  const placement = useFieldPlacement({
    fields,
    defaultFields,
    onChange: record,
    pageSizes,
    recipients: signers,
    fieldSizes,
    snapThreshold,
    createId,
  });
  latest.current = placement.fields;
  const makeId = createId ?? newFieldId;

  const id = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const width = useElementWidth(scroller);
  const [zoom, setZoom] = useState(1);
  const drag = useRef<Drag | null>(null);
  const [guides, setGuides] = useState<{ key: string; guides: Guide[] } | null>(null);
  const [paletteDrag, setPaletteDrag] = useState<PaletteDrag | null>(null);
  const paletteDragWasMove = useRef(false);
  const clipboard = useRef<Field[]>([]);
  const [extra, setExtra] = useState<string[]>([]);
  const [ownPreview, setOwnPreview] = useState(false);
  const previewing = previewingProp ?? ownPreview;
  const setPreviewing = onPreviewingChange ?? setOwnPreview;
  const [inView, setInView] = useState<{ documentId: string; page: number } | null>(null);

  const recipientName = (rid: string) => signers.find((r) => r.id === rid)?.name ?? '';
  const presetOf = (field: Field): TrayPreset | undefined =>
    field.type === 'text'
      ? (Object.keys(labels.trayPresets) as TrayPreset[]).find(
          (key) => labels.trayPresets[key] === field.label,
        )
      : undefined;

  const primary = placement.selectedId;
  const fieldIds = useMemo(() => new Set(placement.fields.map((f) => f.id)), [placement.fields]);
  const selectedIds = useMemo(
    () => (primary ? [primary, ...extra.filter((x) => x !== primary && fieldIds.has(x))] : []),
    [primary, extra, fieldIds],
  );
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const selectOnly = (fieldId: string | null) => {
    setExtra([]);
    placement.select(fieldId);
  };

  const toggleSelected = (fieldId: string) => {
    if (!primary) return placement.select(fieldId);
    if (fieldId === primary) {
      const [next, ...rest] = selectedIds.slice(1);
      setExtra(rest);
      placement.select(next ?? null);
      return;
    }
    setExtra((list) =>
      list.includes(fieldId) ? list.filter((x) => x !== fieldId) : [...list, fieldId],
    );
  };

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
        createId: makeId,
        ...(fieldSizes ? { sizes: fieldSizes } : {}),
      });
      placed += result.fields.length;
      unmatched += result.unmatched.length;
      return result.fields;
    });
    gesture.current = null;
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
    gesture.current = null;
    const { added, removed } = placement.setFieldPages(field.id, pages.pages);
    setTypedPages(null);
    setRepeatNotice({ fieldId: field.id, text: labels.repeatChanged(added, removed) });
  };

  /**
   * The page that fills most of the viewer, with the middle of the part of it on screen in
   * page points, so a field added by a click or Enter lands where the sender is looking.
   */
  const pageInView = useCallback((): {
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
    const size = pageSizes[documentId]?.[page];
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
  }, [pageSizes]);

  // Which page is in view, for the page rail and the page count in the toolbar.
  const frame = useRef(0);
  const trackPage = useCallback(() => {
    if (typeof requestAnimationFrame === 'undefined') return;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const found = pageInView();
      if (!found) return;
      setInView((prev) =>
        prev && prev.documentId === found.documentId && prev.page === found.page
          ? prev
          : { documentId: found.documentId, page: found.page },
      );
    });
  }, [pageInView]);
  useEffect(() => {
    trackPage();
    return () => {
      if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(frame.current);
    };
  }, [trackPage, states]);

  const sizeOf = (item: TrayItem): Size =>
    item.preset
      ? PRESET_SIZE[item.preset]
      : (fieldSizes?.[item.type] ?? defaultFieldSizes[item.type]);

  const addItem = (
    item: TrayItem,
    documentId: string,
    page: number,
    center?: { x: number; y: number },
    avoidOverlap?: boolean,
  ) => {
    gesture.current = null;
    const added = placement.addField(item.type, documentId, page, center, {
      ...(avoidOverlap ? { avoidOverlap } : {}),
      ...(item.preset ? { label: labels.trayPresets[item.preset] } : {}),
    });
    if (added && item.preset) {
      const size = PRESET_SIZE[item.preset];
      gesture.current = `add-${added.id}`;
      lastStep.current = { gesture: gesture.current, at: Date.now() };
      placement.setFieldRect(added.id, {
        ...added.rect,
        x: added.rect.x + added.rect.width / 2 - size.width / 2,
        width: size.width,
        height: size.height,
      });
      gesture.current = null;
    }
    setExtra([]);
  };

  const addToPageInView = (item: TrayItem) => {
    const target = pageInView();
    if (!target) return;
    addItem(item, target.documentId, target.page, target.center, true);
  };

  const onPalettePointerDown = (e: ReactPointerEvent<HTMLButtonElement>, item: TrayItem) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const size = sizeOf(item);
    const scale = pageInView()?.scale ?? 1;
    setPaletteDrag({
      pointerId: e.pointerId,
      item,
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
    const size = documentId ? pageSizes[documentId]?.[pageIndex] : undefined;
    if (!pageEl || !documentId || !size) return;
    const box = pageEl.getBoundingClientRect();
    const scale = box.width / size.width;
    addItem(d.item, documentId, pageIndex, clientToPoints(e.clientX, e.clientY, box, scale));
  };

  const startDrag = (
    e: ReactPointerEvent<HTMLElement>,
    field: Field,
    kind: Drag['kind'],
    scale: number,
    corner: Corner = 'se',
  ) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    if (kind === 'move' && (e.shiftKey || e.metaKey || e.ctrlKey)) {
      toggleSelected(field.id);
      return;
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const moving = kind === 'move' && selectedSet.has(field.id) ? selectedIds : [field.id];
    if (!selectedSet.has(field.id)) selectOnly(field.id);
    const rects = new Map<string, Rect>();
    for (const f of placement.fields) if (moving.includes(f.id)) rects.set(f.id, f.rect);
    drag.current = {
      pointerId: e.pointerId,
      kind,
      corner,
      fieldId: field.id,
      startX: e.clientX,
      startY: e.clientY,
      rects,
      scale,
      gesture: `drag-${e.pointerId}-${Date.now()}`,
    };
  };

  const onDragMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const field = placement.fields.find((f) => f.id === d.fieldId);
    const start = d.rects.get(d.fieldId);
    const page = field && pageSizes[field.documentId]?.[field.page];
    if (!field || !start || !page) return;
    gesture.current = d.gesture;
    const dx = (e.clientX - d.startX) / d.scale;
    const dy = (e.clientY - d.startY) / d.scale;
    if (d.kind === 'resize') {
      placement.setFieldRect(
        d.fieldId,
        resizeFromCorner(start, d.corner, dx, dy, page, placement.minSize),
      );
      gesture.current = null;
      return;
    }
    const neighbours = placement.fields
      .filter((f) => !d.rects.has(f.id) && f.documentId === field.documentId)
      .filter((f) => f.page === field.page)
      .map((f) => f.rect);
    const aligned = alignRect(
      { ...start, x: start.x + dx, y: start.y + dy },
      neighbours,
      page,
      placement.snapThreshold,
    );
    setGuides({ key: `${field.documentId}:${field.page}`, guides: aligned.guides });
    if (d.rects.size === 1) {
      placement.moveField(d.fieldId, aligned.rect);
    } else {
      const shiftX = aligned.rect.x - start.x;
      const shiftY = aligned.rect.y - start.y;
      placement.setFields(
        placement.fields.map((f) => {
          const from = d.rects.get(f.id);
          const size = from && pageSizes[f.documentId]?.[f.page];
          if (!from || !size) return f;
          return {
            ...f,
            rect: roundRect(clampRect({ ...from, x: from.x + shiftX, y: from.y + shiftY }, size)),
          };
        }),
      );
    }
    gesture.current = null;
  };

  const endDrag = (e: ReactPointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId === e.pointerId) {
      drag.current = null;
      setGuides(null);
    }
  };

  const restore = (to: Field[]) => {
    restoring.current = true;
    placement.setFields(to);
    restoring.current = false;
    lastStep.current = { gesture: null, at: 0 };
    setHistoryVersion((v) => v + 1);
  };

  const undo = () => {
    const before = past.current.pop();
    if (!before) return;
    future.current.push(latest.current);
    restore(before);
  };

  const redo = () => {
    const after = future.current.pop();
    if (!after) return;
    past.current.push(latest.current);
    restore(after);
  };

  const selectedFields = placement.fields.filter((f) => selectedSet.has(f.id));

  const copy = () => {
    if (selectedFields.length > 0) {
      clipboard.current = selectedFields;
      setHistoryVersion((v) => v + 1);
    }
  };

  const pasteFields = (from: Field[]) => {
    if (from.length === 0) return;
    gesture.current = null;
    const copies = pasteCopies(from, (doc, page) => pageSizes[doc]?.[page], makeId);
    placement.addFields(copies);
    clipboard.current = copies;
    const [first, ...rest] = copies;
    setExtra(rest.map((f) => f.id));
    placement.select(first?.id ?? null);
  };

  const removeSelected = () => {
    if (selectedIds.length === 0) return;
    gesture.current = null;
    placement.setFields(placement.fields.filter((f) => !selectedSet.has(f.id)));
    selectOnly(null);
  };

  const patchSelected = (change: (f: Field) => Field) => {
    gesture.current = null;
    placement.setFields(placement.fields.map((f) => (selectedSet.has(f.id) ? change(f) : f)));
  };

  const onFieldKey = (e: KeyboardEvent<HTMLElement>, field: Field) => {
    if (isArrowKey(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      const ids = selectedSet.has(field.id) ? selectedIds : [field.id];
      gesture.current = `nudge-${ids.join(',')}-${e.altKey ? 'size' : 'move'}`;
      for (const fieldId of ids) {
        placement.nudgeField(fieldId, e.key, { large: e.shiftKey, resize: e.altKey });
      }
      gesture.current = null;
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      if (selectedIds.length > 1 && selectedSet.has(field.id)) removeSelected();
      else {
        gesture.current = null;
        placement.removeField(field.id);
        setExtra([]);
      }
    } else if (e.key === 'Escape') {
      selectOnly(null);
      e.currentTarget.blur();
    } else if ((e.key === 'Enter' || e.key === ' ') && e.shiftKey) {
      e.preventDefault();
      toggleSelected(field.id);
    }
  };

  const onRootKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (previewing || typing(e.target)) return;
    if (!(e.metaKey || e.ctrlKey)) return;
    const key = e.key.toLowerCase();
    if (key === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (key === 'y') {
      e.preventDefault();
      redo();
    } else if (key === 'c' && selectedFields.length > 0) {
      e.preventDefault();
      copy();
    } else if (key === 'v' && clipboard.current.length > 0) {
      e.preventDefault();
      pasteFields(clipboard.current);
    } else if (key === 'd' && selectedFields.length > 0) {
      e.preventDefault();
      pasteFields(selectedFields);
    }
  };

  // Zooming keeps the middle of what is on screen where it was.
  const allPages = useMemo(
    () => documents.flatMap((d) => states[d.id]?.source?.pages ?? []),
    [documents, states],
  );
  const scale = viewerScale(allPages, width, zoom, 960);
  const lastZoom = useRef({ zoom, scale });
  useLayoutEffect(() => {
    const el = scroller.current;
    const before = lastZoom.current;
    lastZoom.current = { zoom, scale };
    if (!el || before.zoom === zoom || before.scale <= 0) return;
    const ratio = scale / before.scale;
    el.scrollTop = (el.scrollTop + el.clientHeight / 2) * ratio - el.clientHeight / 2;
    el.scrollLeft = (el.scrollLeft + el.clientWidth / 2) * ratio - el.clientWidth / 2;
  }, [zoom, scale]);

  const fitPage = () => {
    const el = scroller.current;
    const tallest = Math.max(1, ...allPages.map((p) => p.height));
    const atOne = viewerScale(allPages, width, 1, 960);
    if (!el || el.clientHeight <= 0) return;
    setZoom(clampZoom((el.clientHeight - 40) / (tallest * atOne)));
  };

  const goToPage = (documentId: string, page: number) => {
    const el = scroller.current?.querySelector<HTMLElement>(
      `[data-cvs-document="${cssEscape(documentId)}"][data-cvs-page="${page}"]`,
    );
    el?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    setInView({ documentId, page });
  };

  const addSignatureFor = (recipient: Recipient) => {
    gesture.current = null;
    const added = Object.entries(pageSizes).flatMap(([documentId, pages]) =>
      pages.length > 0
        ? signatureOnLastPage({
            documentId,
            recipientId: recipient.id,
            pages,
            createId: makeId,
            ...(fieldSizes ? { sizes: fieldSizes } : {}),
          })
        : [],
    );
    placement.addFields(added);
    placement.setRecipientId(recipient.id);
    const first = added[0];
    if (first) {
      selectOnly(first.id);
      goToPage(first.documentId, first.page);
    }
  };

  const showField = (field: Field) => {
    selectOnly(field.id);
    goToPage(field.documentId, field.page);
  };

  const previewRecipient = signers.find((r) => r.id === placement.recipientId) ?? null;

  const renderPreview = ({ documentId, pageIndex, scale: s }: PageContext) =>
    placement.fields
      .filter(
        (f) =>
          f.documentId === documentId &&
          f.page === pageIndex &&
          f.recipientId === previewRecipient?.id,
      )
      .map((field) => {
        const box = pointsToPixels(field.rect, s);
        const text =
          field.type === 'aadhaar'
            ? labels.previewAadhaar
            : field.type === 'signature'
              ? labels.previewSign
              : field.type === 'initials'
                ? labels.previewInitial
                : field.type === 'checkbox'
                  ? ''
                  : field.label || labels.fieldTypes[field.type];
        return (
          <span
            key={field.id}
            className="cvs-preview-field"
            data-type={field.type}
            data-required={field.required || undefined}
            style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
          >
            {text}
          </span>
        );
      });

  const renderOverlay = (ctx: PageContext) => {
    if (previewing) return renderPreview(ctx);
    const { documentId, pageIndex, scale: s } = ctx;
    const onPage = placement.fields.filter(
      (f) => f.documentId === documentId && f.page === pageIndex,
    );
    const lines = guides?.key === `${documentId}:${pageIndex}` ? guides.guides : [];
    return (
      <>
        {lines.map((g) => (
          <span
            key={`${g.axis}-${g.at}`}
            className="cvs-guide-line"
            data-axis={g.axis}
            aria-hidden="true"
            style={g.axis === 'x' ? { left: g.at * s } : { top: g.at * s }}
          />
        ))}
        {onPage.map((field) => {
          const box = pointsToPixels(field.rect, s);
          const selected = selectedSet.has(field.id);
          const single = selected && selectedIds.length === 1;
          const color = recipientColorIndex(signers, field.recipientId);
          const group = placement.groupOf(field.id).length;
          const compact = box.width < 64 || box.height < 18;
          return (
            <div
              key={field.id}
              className="cvs-placed"
              data-type={field.type}
              data-selected={selected || undefined}
              data-compact={compact || undefined}
              data-over-text={overText.has(field.id) || undefined}
              data-cvs-color={color}
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              aria-label={[
                labels.field(
                  field.label || labels.fieldTypes[field.type],
                  recipientName(field.recipientId),
                  field.page + 1,
                ),
                overText.has(field.id) ? labels.overText : '',
              ]
                .filter(Boolean)
                .join(', ')}
              aria-describedby={`${id}-keys`}
              style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
              onPointerDown={(e) => startDrag(e, field, 'move', s)}
              onPointerMove={onDragMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onFocus={() => {
                if (!selectedSet.has(field.id)) selectOnly(field.id);
              }}
              onKeyDown={(e) => onFieldKey(e, field)}
            >
              <span className="cvs-placed-label">
                <Icon name={fieldIcon(field.type, presetOf(field))} className="cvs-placed-icon" />
                {!compact && (
                  <span className="cvs-placed-text">
                    {field.label || labels.fieldTypes[field.type]}
                  </span>
                )}
                {group > 1 && <span className="cvs-placed-badge">{labels.groupBadge(group)}</span>}
                {overText.has(field.id) && (
                  <span className="cvs-placed-badge cvs-placed-warning">{labels.overText}</span>
                )}
              </span>
              {field.required && (
                <span className="cvs-placed-required" aria-hidden="true">
                  *
                </span>
              )}
              {single &&
                (['se', 'nw', 'ne', 'sw'] as const).map((corner) => (
                  <span
                    key={corner}
                    className={`cvs-placed-handle${corner === 'se' ? ' cvs-placed-resize' : ''}`}
                    data-corner={corner}
                    aria-hidden="true"
                    title={labels.resize}
                    onPointerDown={(e) => startDrag(e, field, 'resize', s, corner)}
                    onPointerMove={onDragMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                  />
                ))}
            </div>
          );
        })}
      </>
    );
  };

  const selected = selectedIds.length === 1 ? placement.selected : null;
  const activeColor = recipientColorIndex(signers, placement.recipientId ?? '');
  const active = signers.find((r) => r.id === placement.recipientId);
  const aadhaarActive = active?.auth === 'aadhaar';
  // An Aadhaar eSign signer is offered nothing to place, and nobody is offered the box.
  const offered: FieldType[] = aadhaarActive ? [] : fieldTypes.filter((t) => t !== 'aadhaar');
  const noSigners = signers.length === 0;
  const zoomPercent = Math.round(zoom * 100);
  const zoomChoices = ZOOM_STEPS.includes(zoom)
    ? ZOOM_STEPS
    : [...ZOOM_STEPS, zoom].sort((a, b) => a - b);
  const docInView = documents.find((d) => d.id === inView?.documentId) ?? documents[0];
  const docPageCount = docInView ? (pageSizes[docInView.id]?.length ?? 0) : 0;

  const toolButton = (name: IconName, label: string, onClick: () => void, disabled = false) => (
    <button
      type="button"
      className="cvs-tool"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled || previewing}
    >
      <Icon name={name} />
    </button>
  );

  return (
    <div
      className={['cvs-root', 'cvs-placer', className].filter(Boolean).join(' ')}
      data-previewing={previewing || undefined}
      onKeyDown={onRootKey}
    >
      <aside className="cvs-placer-panel cvs-placer-tools" aria-label={labels.palette}>
        {noSigners ? (
          <p className="cvs-hint cvs-side-empty">{labels.noRecipients}</p>
        ) : (
          <RecipientSwitcher
            placement={placement}
            recipients={signers}
            label={labels.recipient}
            countLabel={labels.fieldCount}
          />
        )}

        <h3 className="cvs-panel-title" id={`${id}-palette`}>
          {labels.palette}
        </h3>
        <div className="cvs-tray" role="group" aria-labelledby={`${id}-palette`}>
          {TRAY.map(({ group, items }) => {
            const shown = items.filter((item) => offered.includes(item.type));
            if (shown.length === 0) return null;
            return (
              <div key={group} className="cvs-tray-group">
                <p className="cvs-tray-title" id={`${id}-tray-${group}`}>
                  {labels.trayGroups[group]}
                </p>
                <div className="cvs-palette" role="group" aria-labelledby={`${id}-tray-${group}`}>
                  {shown.map((item) => {
                    const label = item.preset
                      ? labels.trayPresets[item.preset]
                      : labels.fieldTypes[item.type];
                    return (
                      <button
                        key={item.preset ?? item.type}
                        type="button"
                        className="cvs-palette-item"
                        data-type={item.type}
                        data-cvs-color={activeColor}
                        disabled={noSigners || previewing}
                        aria-describedby={`${id}-palette-hint`}
                        onPointerDown={(e) => onPalettePointerDown(e, item)}
                        onPointerMove={onPalettePointerMove}
                        onPointerUp={onPalettePointerUp}
                        onPointerCancel={() => setPaletteDrag(null)}
                        onClick={() => {
                          // A click that ended a drag has already placed the field.
                          if (!paletteDragWasMove.current) addToPageInView(item);
                          paletteDragWasMove.current = false;
                        }}
                      >
                        <span className="cvs-palette-chip">
                          <Icon
                            name={fieldIcon(item.type, item.preset)}
                            className="cvs-palette-icon"
                          />
                        </span>
                        <span className="cvs-palette-label">{label}</span>
                        <Icon name="grip" className="cvs-palette-grip" />
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <p
          className={aadhaarActive ? 'cvs-hint cvs-hint--esign' : 'cvs-hint'}
          id={`${id}-palette-hint`}
          role={aadhaarActive ? 'note' : undefined}
        >
          {aadhaarActive && active ? labels.aadhaarHint(active.name) : labels.paletteHint}
        </p>

        {!aadhaarActive && (
          <>
            <h3 className="cvs-panel-title">{labels.presets}</h3>
            <div className="cvs-presets" role="group" aria-label={labels.presets}>
              <button
                type="button"
                className="cvs-button cvs-button--quiet"
                disabled={noSigners || previewing}
                onClick={() => {
                  gesture.current = null;
                  placement.addInitialsEveryPage();
                }}
              >
                <Icon name="initials" />
                {labels.initialsEveryPage}
              </button>
              <button
                type="button"
                className="cvs-button cvs-button--quiet"
                disabled={noSigners || previewing}
                onClick={() => {
                  gesture.current = null;
                  placement.addSignatureLastPage();
                }}
              >
                <Icon name="signature" />
                {labels.signatureLastPage}
              </button>
              {tagCount > 0 && !tagsUsed && (
                <button
                  type="button"
                  className="cvs-button cvs-button--primary"
                  disabled={noSigners || previewing}
                  onClick={placeFromTags}
                >
                  {labels.placeFromTags(tagCount)}
                </button>
              )}
            </div>
          </>
        )}
        <p className={notice?.error ? 'cvs-error' : 'cvs-hint'} role="status">
          {notice?.text}
        </p>
      </aside>

      <div className="cvs-viewer">
        <div className="cvs-placer-toolbar" role="toolbar" aria-label={labels.tools}>
          <div className="cvs-toolset">
            {toolButton('undo', labels.undo, undo, past.current.length === 0)}
            {toolButton('redo', labels.redo, redo, future.current.length === 0)}
          </div>
          <span className="cvs-tool-divider" aria-hidden="true" />
          <div className="cvs-toolset cvs-toolset--edit">
            {toolButton('copy', labels.copy, copy, selectedFields.length === 0)}
            {toolButton(
              'paste',
              labels.paste,
              () => pasteFields(clipboard.current),
              clipboard.current.length === 0,
            )}
            {toolButton(
              'duplicate',
              labels.duplicate,
              () => pasteFields(selectedFields),
              selectedFields.length === 0,
            )}
            {toolButton('trash', labels.deleteSelected, removeSelected, selectedIds.length === 0)}
          </div>
          <span className="cvs-spacer" />
          {docPageCount > 0 && (
            <span className="cvs-page-count">
              {labels.page((inView?.page ?? 0) + 1, docPageCount)}
            </span>
          )}
          <div className="cvs-zoom" role="group" aria-label={labels.zoomLevel(zoomPercent)}>
            <button
              type="button"
              className="cvs-tool"
              onClick={() => setZoom(clampZoom(zoom - 0.25))}
              disabled={zoom <= MIN_ZOOM}
              aria-label={labels.zoomOut}
              title={labels.zoomOut}
            >
              <Icon name="minus" />
            </button>
            <select
              className="cvs-zoom-select"
              aria-label={labels.zoom}
              value={String(zoom)}
              onChange={(e) => {
                if (e.target.value === 'page') fitPage();
                else setZoom(clampZoom(Number(e.target.value)));
              }}
            >
              {zoomChoices.map((z) => (
                <option key={z} value={String(z)}>
                  {z === 1 ? labels.fitWidth : `${Math.round(z * 100)}%`}
                </option>
              ))}
              <option value="page">{labels.fitPage}</option>
            </select>
            <button
              type="button"
              className="cvs-tool"
              onClick={() => setZoom(clampZoom(zoom + 0.25))}
              disabled={zoom >= MAX_ZOOM}
              aria-label={labels.zoomIn}
              title={labels.zoomIn}
            >
              <Icon name="plus" />
            </button>
          </div>
          {previewingProp === undefined && onPreviewingChange === undefined && !noSigners && (
            <button
              type="button"
              className="cvs-button cvs-button--quiet cvs-preview-toggle"
              aria-pressed={previewing}
              onClick={() => setPreviewing(!previewing)}
            >
              <Icon name="eye" />
              {previewing ? labels.stopPreview : labels.preview}
            </button>
          )}
        </div>
        {previewing && previewRecipient && (
          <p className="cvs-preview-banner" role="status" data-cvs-color={activeColor}>
            <Icon name="eye" />
            {labels.previewing(previewRecipient.name)}
          </p>
        )}
        <div className="cvs-canvas">
          <nav className="cvs-thumbs" aria-label={labels.pages}>
            {documents.map((doc) => {
              const source = states[doc.id]?.source;
              if (!source) return null;
              return (
                <ol key={doc.id} className="cvs-thumb-list">
                  {source.pages.map((page, index) => {
                    const count = placement.fields.filter(
                      (f) => f.documentId === doc.id && f.page === index,
                    ).length;
                    const current = inView?.documentId === doc.id && inView.page === index;
                    const thumbScale = 76 / page.width;
                    return (
                      <li key={index}>
                        <button
                          type="button"
                          className="cvs-thumb"
                          aria-current={current ? 'page' : undefined}
                          aria-label={labels.goToPage(index + 1, count)}
                          onClick={() => goToPage(doc.id, index)}
                        >
                          <span
                            className="cvs-thumb-sheet"
                            style={{ width: 76, height: page.height * thumbScale }}
                          >
                            <PageImage
                              source={source}
                              pageIndex={index}
                              scale={thumbScale}
                              loadingLabel=""
                              errorLabel=""
                            />
                            {count > 0 && (
                              <span className="cvs-thumb-count" aria-hidden="true">
                                {count}
                              </span>
                            )}
                          </span>
                          <span className="cvs-thumb-number" aria-hidden="true">
                            {index + 1}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              );
            })}
          </nav>
          <div
            ref={scroller}
            className="cvs-scroller"
            tabIndex={0}
            data-dragging={guides ? true : undefined}
            onScroll={trackPage}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) selectOnly(null);
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
      </div>

      <aside className="cvs-placer-panel cvs-placer-side" aria-label={labels.properties}>
        {overText.size > 0 && (
          <p className="cvs-warning" role="status">
            {labels.overTextNote(overText.size)}
          </p>
        )}
        {previewing ? null : selectedIds.length > 1 ? (
          <MultiInspector
            labels={labels}
            fields={selectedFields}
            recipients={signers}
            onAssign={(recipientId) => patchSelected((f) => ({ ...f, recipientId }))}
            onRequired={(required) => patchSelected((f) => ({ ...f, required }))}
            onAlign={(how) => {
              const lead = selectedFields.find((f) => f.id === primary) ?? selectedFields[0];
              if (!lead) return;
              patchSelected((f) => {
                const size = pageSizes[f.documentId]?.[f.page];
                if (!size) return f;
                const rect =
                  how === 'left'
                    ? { ...f.rect, x: lead.rect.x }
                    : how === 'top'
                      ? { ...f.rect, y: lead.rect.y }
                      : { ...f.rect, width: lead.rect.width, height: lead.rect.height };
                return { ...f, rect: roundRect(clampRect(rect, size)) };
              });
            }}
            onDelete={removeSelected}
          />
        ) : selected ? (
          <Inspector
            id={id}
            labels={labels}
            field={selected}
            recipients={signers}
            color={recipientColorIndex(signers, selected.recipientId)}
            icon={fieldIcon(selected.type, presetOf(selected))}
            pageCount={pageSizes[selected.documentId]?.length ?? 0}
            placement={placement}
            typedPages={typedPages?.fieldId === selected.id ? typedPages.text : null}
            repeatNotice={repeatNotice?.fieldId === selected.id ? repeatNotice : null}
            pagesInput={pagesInput}
            onChooseRepeat={(choice) => {
              if (choice !== 'custom') {
                showOnPages(selected, choice);
                return;
              }
              setRepeatNotice(null);
              setTypedPages({
                fieldId: selected.id,
                text: formatPageList(placement.pagesOf(selected.id)),
              });
              // The box appears with this render; move to it so the numbers can be typed at once.
              setTimeout(() => pagesInput.current?.select(), 0);
            }}
            onTypePages={(text) => setTypedPages({ fieldId: selected.id, text })}
            onApplyPages={(text) => showOnPages(selected, 'custom', text)}
            onEdit={(key) => {
              gesture.current = key;
            }}
          />
        ) : noSigners ? null : (
          <FieldsSummary
            labels={labels}
            recipients={signers}
            fields={placement.fields}
            onAddSignature={addSignatureFor}
            onShow={showField}
          />
        )}
        <details className="cvs-shortcuts">
          <summary>
            <Icon name="keyboard" />
            {labels.shortcuts}
          </summary>
          <p className="cvs-hint cvs-keys" id={`${id}-keys`}>
            {labels.keyboardHint}
          </p>
          <dl className="cvs-shortcut-list">
            {labels.shortcutList.map(([keys, action]) => (
              <div key={keys}>
                <dt>{keys}</dt>
                <dd>{action}</dd>
              </div>
            ))}
          </dl>
        </details>
      </aside>

      {paletteDrag?.moved && (
        <div
          className="cvs-drag-ghost"
          data-cvs-color={activeColor}
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
          <Icon name={fieldIcon(paletteDrag.item.type, paletteDrag.item.preset)} />
          <span>
            {paletteDrag.item.preset
              ? labels.trayPresets[paletteDrag.item.preset]
              : labels.fieldTypes[paletteDrag.item.type]}
          </span>
        </div>
      )}
    </div>
  );
}

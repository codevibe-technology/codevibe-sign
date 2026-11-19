import { useCallback, useMemo, useRef, useState } from 'react';
import type { Field, FieldType, Rect, Recipient } from '@codevibe_technology/sign-core';
import type { PageSize } from '../geometry';
import {
  createField,
  defaultFieldSizes,
  NUDGE_STEP,
  NUDGE_STEP_LARGE,
  nudgeRect,
  placeRect,
  sizeRect,
  type ArrowKey,
  type Size,
} from './placement';

export interface UseFieldPlacementOptions {
  /** Controlled fields. Leave undefined to let the hook own them, starting from `defaultFields`. */
  fields?: Field[];
  defaultFields?: Field[];
  onChange?: (fields: Field[]) => void;
  /** Page sizes in points for each document id. */
  pageSizes: Record<string, PageSize[]>;
  recipients: Recipient[];
  fieldSizes?: Partial<Record<FieldType, Size>>;
  /** Distance in points within which a dragged field snaps to a page edge. */
  snapThreshold?: number;
  /** Smallest width or height in points. */
  minSize?: number;
  createId?: () => string;
}

export interface FieldPlacementState {
  fields: Field[];
  selectedId: string | null;
  selected: Field | null;
  select: (id: string | null) => void;
  /** Recipient that new fields are assigned to. */
  recipientId: string | null;
  setRecipientId: (id: string) => void;
  addField: (
    type: FieldType,
    documentId: string,
    page: number,
    center?: { x: number; y: number },
  ) => Field | null;
  /** Moves a field to the rect's position, with snapping and clamping. */
  moveField: (id: string, rect: Rect) => void;
  resizeField: (id: string, width: number, height: number) => void;
  nudgeField: (id: string, key: ArrowKey, options?: { large?: boolean; resize?: boolean }) => void;
  updateField: (
    id: string,
    patch: Partial<Pick<Field, 'recipientId' | 'required' | 'label'>>,
  ) => void;
  removeField: (id: string) => void;
  pageSize: (documentId: string, page: number) => PageSize | undefined;
  snapThreshold: number;
  minSize: number;
}

let counter = 0;
function defaultId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  counter += 1;
  return `field-${Date.now().toString(36)}-${counter}`;
}

/** Headless state for placing fields on document pages. Every rect is in PDF points, top-left origin. */
export function useFieldPlacement(options: UseFieldPlacementOptions): FieldPlacementState {
  const {
    fields: controlled,
    defaultFields = [],
    onChange,
    pageSizes,
    recipients,
    fieldSizes,
    snapThreshold = 6,
    minSize = 8,
    createId = defaultId,
  } = options;

  const [own, setOwn] = useState<Field[]>(defaultFields);
  const fields = controlled ?? own;
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chosenRecipient, setRecipientId] = useState<string | null>(null);
  const recipientId =
    chosenRecipient && recipients.some((r) => r.id === chosenRecipient)
      ? chosenRecipient
      : (recipients[0]?.id ?? null);

  const commit = useCallback(
    (next: Field[]) => {
      fieldsRef.current = next;
      if (controlled === undefined) setOwn(next);
      onChange?.(next);
    },
    [controlled, onChange],
  );

  const pageSize = useCallback(
    (documentId: string, page: number) => pageSizes[documentId]?.[page],
    [pageSizes],
  );

  const update = useCallback(
    (id: string, change: (field: Field, page: PageSize) => Field) => {
      const current = fieldsRef.current;
      const index = current.findIndex((f) => f.id === id);
      const field = current[index];
      if (!field) return;
      const page = pageSize(field.documentId, field.page);
      if (!page) return;
      const next = current.slice();
      next[index] = change(field, page);
      commit(next);
    },
    [commit, pageSize],
  );

  const addField = useCallback(
    (type: FieldType, documentId: string, page: number, center?: { x: number; y: number }) => {
      const size = pageSize(documentId, page);
      if (!size || !recipientId) return null;
      const field = createField({
        id: createId(),
        documentId,
        recipientId,
        type,
        page,
        center: center ?? { x: size.width / 2, y: size.height / 2 },
        size: fieldSizes?.[type] ?? defaultFieldSizes[type],
        pageSize: size,
      });
      commit([...fieldsRef.current, field]);
      setSelectedId(field.id);
      return field;
    },
    [pageSize, recipientId, createId, fieldSizes, commit],
  );

  const moveField = useCallback(
    (id: string, rect: Rect) =>
      update(id, (f, page) => ({ ...f, rect: placeRect(rect, page, snapThreshold) })),
    [update, snapThreshold],
  );

  const resizeField = useCallback(
    (id: string, width: number, height: number) =>
      update(id, (f, page) => ({
        ...f,
        rect: sizeRect(f.rect, width, height, page, minSize, snapThreshold),
      })),
    [update, minSize, snapThreshold],
  );

  const nudgeField = useCallback(
    (id: string, key: ArrowKey, opts: { large?: boolean; resize?: boolean } = {}) =>
      update(id, (f, page) => ({
        ...f,
        rect: nudgeRect(f.rect, key, opts.large ? NUDGE_STEP_LARGE : NUDGE_STEP, page, {
          resize: opts.resize,
          minSize,
        }),
      })),
    [update, minSize],
  );

  const updateField = useCallback(
    (id: string, patch: Partial<Pick<Field, 'recipientId' | 'required' | 'label'>>) =>
      update(id, (f) => ({ ...f, ...patch })),
    [update],
  );

  const removeField = useCallback(
    (id: string) => {
      commit(fieldsRef.current.filter((f) => f.id !== id));
      setSelectedId((current) => (current === id ? null : current));
    },
    [commit],
  );

  const selected = useMemo(
    () => fields.find((f) => f.id === selectedId) ?? null,
    [fields, selectedId],
  );

  return {
    fields,
    selectedId: selected ? selectedId : null,
    selected,
    select: setSelectedId,
    recipientId,
    setRecipientId,
    addField,
    moveField,
    resizeField,
    nudgeField,
    updateField,
    removeField,
    pageSize,
    snapThreshold,
    minSize,
  };
}

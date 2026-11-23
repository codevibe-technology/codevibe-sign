import { useCallback, useMemo, useRef, useState } from 'react';
import type { Field, FieldType, Rect, Recipient } from '@codevibe_technology/sign-core';
import { clampRect, roundRect, type PageSize } from '../geometry';
import {
  fieldGroups,
  initialsOnEveryPage,
  repeatField as repeatCopies,
  scaleRectBetween,
  signatureOnLastPage,
} from './multipage';
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
    options?: { avoidOverlap?: boolean; label?: string },
  ) => Field | null;
  /** Moves a field to the rect's position, with snapping and clamping. */
  moveField: (id: string, rect: Rect) => void;
  resizeField: (id: string, width: number, height: number) => void;
  /** Gives a field a new position and size, kept on its page. */
  setFieldRect: (id: string, rect: Rect) => void;
  nudgeField: (id: string, key: ArrowKey, options?: { large?: boolean; resize?: boolean }) => void;
  updateField: (
    id: string,
    patch: Partial<Pick<Field, 'recipientId' | 'required' | 'label'>>,
  ) => void;
  removeField: (id: string) => void;
  /** Adds ready-made fields, for example placed from text tags. */
  addFields: (fields: Field[]) => void;
  /** Replaces every field at once: undo, redo, paste and moves of several fields. */
  setFields: (fields: Field[]) => void;
  /**
   * The linked copies a field belongs to (itself included): copies made by "Repeat on pages",
   * or a field moved away from its copies a moment ago. Empty when it stands alone.
   */
  groupOf: (id: string) => string[];
  /** Copies a field onto `pages` (zero-based) of its document, at the same spot. */
  repeatField: (id: string, pages: number[]) => number;
  /**
   * Makes the field show on exactly `pages` (zero-based) of its document: copies it to the
   * pages that lack it and deletes its copies elsewhere. Its own page always keeps it.
   */
  setFieldPages: (id: string, pages: number[]) => { added: number; removed: number };
  /** The pages (zero-based, in order) the field and its linked copies are on. */
  pagesOf: (id: string) => number[];
  /** Gives every copy in the field's group its position, size, required flag and label. */
  applyToGroup: (id: string) => void;
  /** Deletes the field and every copy in its group. */
  removeGroup: (id: string) => void;
  /** Initials in the bottom-right corner of every page, for the current recipient. */
  addInitialsEveryPage: () => number;
  /** A signature on the last page of each document, for the current recipient. */
  addSignatureLastPage: () => number;
  pageSize: (documentId: string, page: number) => PageSize | undefined;
  snapThreshold: number;
  minSize: number;
}

const pageSizeOf =
  (sizes: Record<string, PageSize[]>) =>
  (documentId: string, page: number): PageSize | undefined =>
    sizes[documentId]?.[page];

let counter = 0;
/** A new field id: a UUID where the platform has one. */
export function newFieldId(): string {
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
    createId = newFieldId,
  } = options;

  const [own, setOwn] = useState<Field[]>(defaultFields);
  const fields = controlled ?? own;
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // A grouped field that is moved no longer sits with its copies; remember them so the
  // change can still be applied to all.
  const [remembered, setRemembered] = useState<Record<string, string[]>>({});
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

  const groupsOf = useCallback(
    (list: Field[]) => fieldGroups(list, pageSizeOf(pageSizes)),
    [pageSizes],
  );

  const update = useCallback(
    (id: string, change: (field: Field, page: PageSize) => Field) => {
      const current = fieldsRef.current;
      const group = groupsOf(current).get(id);
      if (group) setRemembered((prev) => (prev[id] ? prev : { ...prev, [id]: group }));
      const index = current.findIndex((f) => f.id === id);
      const field = current[index];
      if (!field) return;
      const page = pageSize(field.documentId, field.page);
      if (!page) return;
      const next = current.slice();
      next[index] = change(field, page);
      commit(next);
    },
    [commit, pageSize, groupsOf],
  );

  const addField = useCallback(
    (
      type: FieldType,
      documentId: string,
      page: number,
      center?: { x: number; y: number },
      options: { avoidOverlap?: boolean; label?: string } = {},
    ) => {
      const size = pageSize(documentId, page);
      if (!size || !recipientId) return null;
      // A field added without a drop point must not land on top of one already there.
      const avoid =
        (options.avoidOverlap ?? center === undefined)
          ? fieldsRef.current
              .filter((f) => f.documentId === documentId && f.page === page)
              .map((f) => f.rect)
          : undefined;
      const created = createField({
        id: createId(),
        documentId,
        recipientId,
        type,
        page,
        center: center ?? { x: size.width / 2, y: size.height / 2 },
        size: fieldSizes?.[type] ?? defaultFieldSizes[type],
        pageSize: size,
        ...(avoid ? { avoid } : {}),
      });
      const field = options.label ? { ...created, label: options.label } : created;
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

  const setFieldRect = useCallback(
    (id: string, rect: Rect) =>
      update(id, (f, page) => ({ ...f, rect: roundRect(clampRect(rect, page, minSize)) })),
    [update, minSize],
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

  const addFields = useCallback(
    (added: Field[]) => {
      if (added.length > 0) commit([...fieldsRef.current, ...added]);
    },
    [commit],
  );

  const groups = useMemo(() => groupsOf(fields), [groupsOf, fields]);

  const groupOf = useCallback(
    (id: string) => {
      const live = groups.get(id);
      if (live) return live;
      const ids = new Set(fields.map((f) => f.id));
      const kept = (remembered[id] ?? []).filter((member) => ids.has(member));
      return kept.length > 1 ? kept : [];
    },
    [groups, remembered, fields],
  );

  const repeatField = useCallback(
    (id: string, pages: number[]) => {
      const field = fieldsRef.current.find((f) => f.id === id);
      if (!field) return 0;
      const taken = new Set(
        fieldsRef.current
          .filter((f) => groupOf(id).includes(f.id) || f.id === id)
          .map((f) => f.page),
      );
      const copies = repeatCopies(
        field,
        pages,
        (page) => pageSize(field.documentId, page),
        createId,
        taken,
      );
      addFields(copies);
      return copies.length;
    },
    [groupOf, pageSize, createId, addFields],
  );

  const pagesOf = useCallback(
    (id: string) => {
      const members = new Set([id, ...groupOf(id)]);
      return fields
        .filter((f) => members.has(f.id))
        .map((f) => f.page)
        .sort((a, b) => a - b);
    },
    [groupOf, fields],
  );

  const setFieldPages = useCallback(
    (id: string, pages: number[]) => {
      const current = fieldsRef.current;
      const field = current.find((f) => f.id === id);
      if (!field) return { added: 0, removed: 0 };
      const wanted = new Set([...pages, field.page]);
      const members = new Set(groupOf(id));
      const dropped = new Set(
        current
          .filter((f) => f.id !== id && members.has(f.id) && !wanted.has(f.page))
          .map((f) => f.id),
      );
      const kept = current.filter((f) => !dropped.has(f.id));
      const taken = new Set(
        kept.filter((f) => f.id === id || members.has(f.id)).map((f) => f.page),
      );
      const copies = repeatCopies(
        field,
        [...wanted].sort((a, b) => a - b),
        (page) => pageSize(field.documentId, page),
        createId,
        taken,
      );
      if (dropped.size > 0 || copies.length > 0) commit([...kept, ...copies]);
      return { added: copies.length, removed: dropped.size };
    },
    [groupOf, pageSize, createId, commit],
  );

  const applyToGroup = useCallback(
    (id: string) => {
      const members = new Set(groupOf(id));
      const source = fieldsRef.current.find((f) => f.id === id);
      const from = source && pageSize(source.documentId, source.page);
      if (!source || !from) return;
      commit(
        fieldsRef.current.map((f) => {
          if (f.id === id || !members.has(f.id)) return f;
          const to = pageSize(f.documentId, f.page);
          if (!to) return f;
          return {
            ...f,
            rect: scaleRectBetween(source.rect, from, to),
            required: source.required,
            ...(source.label !== undefined ? { label: source.label } : {}),
          };
        }),
      );
      setRemembered((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [groupOf, pageSize, commit],
  );

  const removeGroup = useCallback(
    (id: string) => {
      const members = new Set([id, ...groupOf(id)]);
      commit(fieldsRef.current.filter((f) => !members.has(f.id)));
      setSelectedId(null);
    },
    [groupOf, commit],
  );

  const preset = useCallback(
    (make: typeof initialsOnEveryPage) => {
      if (!recipientId) return 0;
      const added = Object.entries(pageSizes).flatMap(([documentId, pages]) =>
        pages.length > 0
          ? make({
              documentId,
              recipientId,
              pages,
              createId,
              ...(fieldSizes ? { sizes: fieldSizes } : {}),
            })
          : [],
      );
      addFields(added);
      return added.length;
    },
    [recipientId, pageSizes, createId, fieldSizes, addFields],
  );

  const addInitialsEveryPage = useCallback(() => preset(initialsOnEveryPage), [preset]);
  const addSignatureLastPage = useCallback(() => preset(signatureOnLastPage), [preset]);

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
    setFieldRect,
    nudgeField,
    updateField,
    removeField,
    addFields,
    setFields: commit,
    groupOf,
    repeatField,
    setFieldPages,
    pagesOf,
    applyToGroup,
    removeGroup,
    addInitialsEveryPage,
    addSignatureLastPage,
    pageSize,
    snapThreshold,
    minSize,
  };
}

import { useId, type RefObject } from 'react';
import type { Field, Recipient } from '@codevibe_technology/sign-core';
import { recipientColorIndex } from '../labels';
import type { FieldPlacerLabels } from './FieldPlacer';
import { Icon, type IconName } from './icons';
import { choiceForPages, formatPageList, type RepeatChoice } from './multipage';
import type { FieldPlacementState } from './useFieldPlacement';

/** Text fields the tray offers with a label already set. */
export type TrayPreset = 'email' | 'company' | 'title';

/** One or two capital letters for an avatar. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0]!, parts[parts.length - 1]!] : parts;
  return letters.map((p) => Array.from(p)[0]?.toUpperCase() ?? '').join('') || '?';
}

function Avatar({ name, color }: { name: string; color: number }) {
  return (
    <span className="cvs-avatar" data-cvs-color={color} aria-hidden="true">
      {initialsOf(name)}
    </span>
  );
}

/** Whose fields the tray adds: one row per signer, in their colour, with their field count. */
export function RecipientSwitcher({
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
        const active = placement.recipientId === r.id;
        return (
          <div
            key={r.id}
            className="cvs-recipient"
            data-cvs-color={index % 6}
            data-active={active || undefined}
          >
            <label className="cvs-recipient-main">
              <input
                type="radio"
                name={id}
                className="cvs-visually-hidden"
                checked={active}
                onChange={() => placement.setRecipientId(r.id)}
              />
              <Avatar name={r.name} color={index % 6} />
              <span className="cvs-recipient-name">{r.name}</span>
            </label>
            <span
              className="cvs-recipient-count"
              data-empty={(count === 0 && r.role === 'signer') || undefined}
            >
              {countLabel(count)}
            </span>
            {active && <Icon name="check" className="cvs-recipient-tick" />}
          </div>
        );
      })}
    </div>
  );
}

interface InspectorProps {
  id: string;
  labels: FieldPlacerLabels;
  field: Field;
  recipients: Recipient[];
  color: number;
  icon: IconName;
  pageCount: number;
  placement: FieldPlacementState;
  typedPages: string | null;
  repeatNotice: { text: string; error?: boolean } | null;
  pagesInput: RefObject<HTMLInputElement | null>;
  onChooseRepeat: (choice: RepeatChoice) => void;
  onTypePages: (text: string) => void;
  onApplyPages: (text: string) => void;
  /** Called before an edit: edits under one key (typing a label) undo as one step. */
  onEdit: (key: string | null) => void;
}

/** Properties of the one selected field. */
export function Inspector({
  id,
  labels,
  field,
  recipients,
  color,
  icon,
  pageCount,
  placement,
  typedPages,
  repeatNotice,
  pagesInput,
  onChooseRepeat,
  onTypePages,
  onApplyPages,
  onEdit,
}: InspectorProps) {
  const group = placement.groupOf(field.id).length;
  const owner = recipients.find((r) => r.id === field.recipientId)?.name ?? '';
  const title = field.label || labels.fieldTypes[field.type];
  const labelled = field.type !== 'signature' && field.type !== 'initials';
  return (
    <div className="cvs-inspector" role="group" aria-label={labels.selectedField}>
      <div className="cvs-inspector-head" data-cvs-color={color}>
        <span className="cvs-palette-chip">
          <Icon name={icon} className="cvs-palette-icon" />
        </span>
        <div className="cvs-inspector-heading">
          <h3 className="cvs-inspector-title">{title}</h3>
          <p className="cvs-inspector-sub">{labels.onPage(field.page + 1, owner)}</p>
        </div>
      </div>

      <div className="cvs-prop">
        <label className="cvs-label" htmlFor={`${id}-assign`}>
          {labels.assignedTo}
        </label>
        <select
          id={`${id}-assign`}
          className="cvs-input"
          value={field.recipientId}
          onChange={(e) => {
            onEdit(null);
            placement.updateField(field.id, { recipientId: e.target.value });
          }}
        >
          {recipients.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      <label className="cvs-check cvs-switch">
        <input
          type="checkbox"
          checked={field.required}
          onChange={(e) => {
            onEdit(null);
            placement.updateField(field.id, { required: e.target.checked });
          }}
        />
        <span className="cvs-switch-track" aria-hidden="true" />
        {labels.required}
      </label>

      {labelled && (
        <div className="cvs-prop">
          <label className="cvs-label" htmlFor={`${id}-label`}>
            {labels.fieldLabel}
          </label>
          <input
            id={`${id}-label`}
            className="cvs-input"
            value={field.label ?? ''}
            maxLength={80}
            placeholder={labels.fieldTypes[field.type]}
            aria-describedby={`${id}-label-hint`}
            onChange={(e) => {
              onEdit(`label-${field.id}`);
              const label = e.target.value;
              placement.updateField(field.id, { label: label === '' ? undefined : label });
            }}
          />
          <p className="cvs-hint" id={`${id}-label-hint`}>
            {labels.fieldLabelHint}
          </p>
        </div>
      )}

      <RepeatControl
        id={id}
        labels={labels}
        pageCount={pageCount}
        page={field.page}
        pages={placement.pagesOf(field.id)}
        typed={typedPages}
        notice={repeatNotice}
        inputRef={pagesInput}
        onChoose={onChooseRepeat}
        onType={onTypePages}
        onApply={onApplyPages}
      />

      <fieldset className="cvs-prop cvs-size">
        <legend className="cvs-label">{labels.size}</legend>
        {(['width', 'height'] as const).map((side) => (
          <label key={side} className="cvs-size-input">
            <span>{labels[side]}</span>
            <input
              className="cvs-input"
              type="number"
              inputMode="decimal"
              min={placement.minSize}
              step={1}
              value={Math.round(field.rect[side])}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (!Number.isFinite(value) || value <= 0) return;
                onEdit(`size-${field.id}`);
                placement.setFieldRect(field.id, { ...field.rect, [side]: value });
              }}
            />
          </label>
        ))}
      </fieldset>

      <div className="cvs-inspector-actions">
        {group > 1 ? (
          <>
            <button
              type="button"
              className="cvs-button"
              onClick={() => {
                onEdit(null);
                placement.applyToGroup(field.id);
              }}
            >
              {labels.applyToGroup(group)}
            </button>
            <button
              type="button"
              className="cvs-button cvs-button--danger-quiet"
              onClick={() => {
                onEdit(null);
                placement.removeField(field.id);
              }}
            >
              <Icon name="trash" />
              {labels.deleteThis}
            </button>
            <button
              type="button"
              className="cvs-button cvs-button--danger-quiet"
              onClick={() => {
                onEdit(null);
                placement.removeGroup(field.id);
              }}
            >
              {labels.deleteGroup(group)}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="cvs-button cvs-button--danger-quiet"
            onClick={() => {
              onEdit(null);
              placement.removeField(field.id);
            }}
          >
            <Icon name="trash" />
            {labels.deleteField}
          </button>
        )}
      </div>
    </div>
  );
}

/** Changes made to every selected field at once. */
export function MultiInspector({
  labels,
  fields,
  recipients,
  onAssign,
  onRequired,
  onAlign,
  onDelete,
}: {
  labels: FieldPlacerLabels;
  fields: Field[];
  recipients: Recipient[];
  onAssign: (recipientId: string) => void;
  onRequired: (required: boolean) => void;
  onAlign: (how: 'left' | 'top' | 'size') => void;
  onDelete: () => void;
}) {
  const id = useId();
  const owners = new Set(fields.map((f) => f.recipientId));
  const owner = owners.size === 1 ? [...owners][0]! : '';
  const allRequired = fields.every((f) => f.required);
  return (
    <div className="cvs-inspector" role="group" aria-label={labels.selectedCount(fields.length)}>
      <div className="cvs-inspector-head">
        <span className="cvs-palette-chip cvs-palette-chip--count">{fields.length}</span>
        <div className="cvs-inspector-heading">
          <h3 className="cvs-inspector-title">{labels.selectedCount(fields.length)}</h3>
        </div>
      </div>
      <div className="cvs-prop">
        <label className="cvs-label" htmlFor={`${id}-assign`}>
          {labels.assignAll}
        </label>
        <select
          id={`${id}-assign`}
          className="cvs-input"
          value={owner}
          onChange={(e) => e.target.value && onAssign(e.target.value)}
        >
          {owner === '' && <option value="">{labels.mixed}</option>}
          {recipients.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <label className="cvs-check cvs-switch">
        <input
          type="checkbox"
          checked={allRequired}
          onChange={(e) => onRequired(e.target.checked)}
        />
        <span className="cvs-switch-track" aria-hidden="true" />
        {labels.required}
      </label>
      <div className="cvs-align" role="group" aria-label={labels.tools}>
        {(
          [
            ['left', 'alignLeft', labels.alignLeft],
            ['top', 'alignTop', labels.alignTop],
            ['size', 'sameSize', labels.sameSize],
          ] as const
        ).map(([how, icon, label]) => (
          <button
            key={how}
            type="button"
            className="cvs-tool"
            aria-label={label}
            title={label}
            onClick={() => onAlign(how)}
          >
            <Icon name={icon} />
          </button>
        ))}
      </div>
      <div className="cvs-inspector-actions">
        <button type="button" className="cvs-button cvs-button--danger-quiet" onClick={onDelete}>
          <Icon name="trash" />
          {labels.deleteCount(fields.length)}
        </button>
      </div>
    </div>
  );
}

/**
 * What each signer has to do, with what is missing: a signer without a signature field, or a
 * field the sender may want to look at again.
 */
export function FieldsSummary({
  labels,
  recipients,
  fields,
  onAddSignature,
  onShow,
}: {
  labels: FieldPlacerLabels;
  recipients: Recipient[];
  fields: Field[];
  onAddSignature: (recipient: Recipient) => void;
  onShow: (field: Field) => void;
}) {
  return (
    <section className="cvs-summary" aria-label={labels.summary}>
      <h3 className="cvs-panel-title">{labels.summary}</h3>
      <ul className="cvs-summary-list">
        {recipients.map((r) => {
          const own = fields.filter((f) => f.recipientId === r.id);
          const required = own.filter((f) => f.required).length;
          const aadhaar = r.auth === 'aadhaar';
          const missingSignature =
            r.role === 'signer' && !own.some((f) => f.type === (aadhaar ? 'aadhaar' : 'signature'));
          const color = recipientColorIndex(recipients, r.id);
          return (
            <li key={r.id} className="cvs-summary-row" data-cvs-color={color}>
              <div className="cvs-summary-who">
                <Avatar name={r.name} color={color} />
                <div className="cvs-summary-text">
                  <p className="cvs-summary-name">{r.name}</p>
                  <p className="cvs-summary-count">
                    {labels.summaryCounts(required, own.length - required)}
                  </p>
                </div>
                {own[0] && (
                  <button
                    type="button"
                    className="cvs-link"
                    onClick={() => onShow(own[0]!)}
                    aria-label={`${labels.showField}: ${r.name}`}
                  >
                    {labels.showField}
                  </button>
                )}
              </div>
              {missingSignature && (
                <div className="cvs-summary-warning">
                  <Icon name="warning" />
                  <span>{aadhaar ? labels.noAadhaarBox : labels.noSignature}</span>
                  <button type="button" className="cvs-link" onClick={() => onAddSignature(r)}>
                    {aadhaar ? labels.addAadhaarBoxFor(r.name) : labels.addSignatureFor(r.name)}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="cvs-hint cvs-side-empty">
        <Icon name="cursor" />
        <span>{labels.selectHint}</span>
      </p>
    </section>
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
    <div className="cvs-prop cvs-repeat">
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

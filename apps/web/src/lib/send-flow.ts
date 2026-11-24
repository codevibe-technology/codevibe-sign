import {
  isValidEmail,
  isValidPhone,
  type AuthMethod,
  type Field,
  type PageSize,
  type RecipientRole,
  type RoutingMode,
} from '@codevibe_technology/sign-core';
import { SMS_CODES_AVAILABLE, SMS_UNAVAILABLE_MESSAGE } from './envelopes';
import type { ApiEnvelope as Envelope } from '@codevibe_technology/sign-server';

/** Matches the sign server's limits, so a file is refused before it is uploaded. */
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_DOCUMENTS = 20;
export const MAX_RECIPIENTS = 50;
export const TITLE_MAX = 200;
export const MESSAGE_MAX = 5000;
export const CHANGE_NOTE_MAX = 2000;

export const STEPS = [
  { key: 'documents', label: 'Documents' },
  { key: 'recipients', label: 'Recipients' },
  { key: 'fields', label: 'Fields' },
  { key: 'review', label: 'Review & send' },
] as const;

export type StepKey = (typeof STEPS)[number]['key'];

export interface DraftDocument {
  /** The server's document id once the draft exists, else a local id. */
  id: string;
  name: string;
  size: number;
  pages: PageSize[];
  /** The file's bytes when picked in this session; reopened drafts load from the server. */
  bytes?: Uint8Array;
  /** Where the server keeps the checked file until a template using it is saved. */
  stagedKey?: string;
}

export interface DraftRecipient {
  /** The server's recipient id once saved (`saved`), else a local key. */
  id: string;
  saved: boolean;
  name: string;
  email: string;
  phone: string;
  role: RecipientRole;
  auth: AuthMethod;
}

export interface DraftSettings {
  title: string;
  message: string;
  /** For a revised envelope: what changed, shown to recipients as "What changed: …". */
  changeNote?: string;
  expiresInDays: number;
  /** 0 turns automatic reminders off. */
  remindEveryDays: number;
}

export interface SendFlowState {
  envelopeId: string | null;
  documents: DraftDocument[];
  recipients: DraftRecipient[];
  routing: RoutingMode;
  fields: Field[];
  settings: DraftSettings;
}

export const EXPIRY_OPTIONS = [7, 14, 30, 60, 90] as const;
export const REMINDER_OPTIONS = [
  { days: 0, label: 'Off' },
  { days: 1, label: 'Every day' },
  { days: 2, label: 'Every 2 days' },
  { days: 3, label: 'Every 3 days' },
  { days: 7, label: 'Every week' },
] as const;

export const emptySettings = (): DraftSettings => ({
  title: '',
  message: '',
  expiresInDays: 30,
  remindEveryDays: 2,
});

let localCounter = 0;
export const localId = (prefix: string) =>
  `${prefix}_local_${Date.now().toString(36)}${++localCounter}`;

export const newRecipient = (): DraftRecipient => ({
  id: localId('rcp'),
  saved: false,
  name: '',
  email: '',
  phone: '',
  role: 'signer',
  auth: 'email_otp',
});

/** A title from the first file's name: "offer-letter_v2.pdf" becomes "Offer letter v2". */
export function titleFromFileName(name: string): string {
  const base = name
    .replace(/\.pdf$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (base.charAt(0).toUpperCase() + base.slice(1)).slice(0, TITLE_MAX);
}

/** Problems keyed by a field path such as `recipients.<id>.email`; empty when all is well. */
export type Problems = Record<string, string>;

const MB = 1024 * 1024;

/** What is wrong with a file before it is uploaded; null when it may be sent to the server. */
export function fileProblem(file: { name: string; size: number; type: string }): string | null {
  const looksPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!looksPdf) return `${file.name} is not a PDF. Save or export it as PDF and add it again.`;
  if (file.size === 0) return `${file.name} is empty. Pick the file again.`;
  if (file.size > MAX_PDF_BYTES) {
    return `${file.name} is ${(file.size / MB).toFixed(1)} MB; the limit is ${MAX_PDF_BYTES / MB} MB. Compress it or split it into smaller files.`;
  }
  return null;
}

export function documentProblems(documents: DraftDocument[]): Problems {
  if (documents.length === 0) return { documents: 'Add at least one PDF to send.' };
  if (documents.length > MAX_DOCUMENTS) {
    return { documents: `Send at most ${MAX_DOCUMENTS} documents in one envelope.` };
  }
  return {};
}

export function recipientProblems(recipients: DraftRecipient[]): Problems {
  const problems: Problems = {};
  if (recipients.length === 0) {
    problems.recipients = 'Add the people who need to sign.';
    return problems;
  }
  if (recipients.length > MAX_RECIPIENTS) {
    problems.recipients = `An envelope can have at most ${MAX_RECIPIENTS} recipients.`;
  }
  if (!recipients.some((r) => r.role !== 'viewer')) {
    problems.recipients = 'Make at least one person a signer or an approver.';
  }
  // The same person may appear twice with different roles (signs, then approves), not twice
  // with the same one.
  const seen = new Set<string>();
  for (const r of recipients) {
    const at = `recipients.${r.id}`;
    if (!r.name.trim()) problems[`${at}.name`] = 'Enter their name.';
    else if (r.name.trim().length > 200) {
      problems[`${at}.name`] = 'Keep the name under 200 characters.';
    }
    const email = r.email.trim().toLowerCase();
    if (!email) problems[`${at}.email`] = 'Enter an email address; the signing link goes there.';
    else if (!isValidEmail(email)) {
      problems[`${at}.email`] = 'This email address does not look right.';
    } else if (seen.has(`${email}:${r.role}`)) {
      problems[`${at}.email`] = 'This person is already in the list with the same role.';
    }
    if (email) seen.add(`${email}:${r.role}`);
    const phone = r.phone.replace(/[\s()-]/g, '');
    if (r.auth === 'sms_otp' && !SMS_CODES_AVAILABLE) {
      problems[`${at}.auth`] = SMS_UNAVAILABLE_MESSAGE;
    } else if (r.auth === 'sms_otp' && !phone) {
      problems[`${at}.phone`] = 'Enter a mobile number for the SMS code.';
    } else if (phone && !isValidPhone(phone)) {
      problems[`${at}.phone`] = 'Use the international format, for example +919812345678.';
    }
  }
  return problems;
}

const INDIAN_MOBILE = /^(?:\+?91)?\d{10}$/;

/**
 * The rules of an Aadhaar eSign, which signs the finished file: one such signer, on one
 * document, and they act last. The server checks the same rules when the envelope is sent.
 */
export function aadhaarProblems(
  state: Pick<SendFlowState, 'documents' | 'recipients' | 'routing'>,
): Problems {
  const problems: Problems = {};
  const aadhaar = state.recipients.filter((r) => r.auth === 'aadhaar' && r.role !== 'viewer');
  const first = aadhaar[0];
  if (!first) return problems;
  for (const r of aadhaar) {
    if (r.role !== 'signer') {
      problems[`recipients.${r.id}.auth`] =
        'Aadhaar eSign is for signers. Pick another identity check for an approver.';
    }
    const phone = r.phone.replace(/[\s()-]/g, '');
    if (phone && !INDIAN_MOBILE.test(phone)) {
      problems[`recipients.${r.id}.phone`] =
        'Aadhaar eSign needs a 10-digit Indian mobile number, or leave this empty.';
    }
  }
  for (const r of aadhaar.slice(1)) {
    problems[`recipients.${r.id}.auth`] =
      'Only one person in an envelope can sign with Aadhaar eSign.';
  }
  const at = `recipients.${first.id}.auth`;
  const actors = state.recipients.filter((r) => r.role !== 'viewer');
  if (problems[at]) return problems;
  if (state.documents.length > 1) {
    problems[at] =
      'Aadhaar eSign covers one document. Send the other documents in their own envelope.';
  } else if (actors.length > 1 && actors[actors.length - 1]?.id !== first.id) {
    problems[at] =
      `${first.name.trim() || 'This signer'} signs with Aadhaar eSign and has to be last. Move them below the others.`;
  } else if (actors.length > 1 && state.routing !== 'sequential') {
    problems[at] =
      'With Aadhaar eSign the others sign first. Choose "One after another" as the signing order.';
  }
  return problems;
}

/**
 * Every signer needs a required signature field. A signer with Aadhaar eSign fills in
 * nothing; one optional Aadhaar seal position may say where Leegality draws the signature.
 * Their signature and initials fields are dropped on send; a second box or any other field
 * is refused, as the server does.
 */
export function fieldProblems(recipients: DraftRecipient[], fields: Field[]): Problems {
  const problems: Problems = {};
  for (const r of recipients.filter((x) => x.role === 'signer')) {
    const name = r.name.trim() || 'this signer';
    const own = fields.filter((f) => f.recipientId === r.id);
    if (r.auth === 'aadhaar') {
      const filled = own.filter(
        (f) => f.type !== 'signature' && f.type !== 'initials' && f.type !== 'aadhaar',
      );
      if (filled.length > 0) {
        problems[`fields.${r.id}`] =
          `${name} signs with Aadhaar eSign and fills in nothing here. Delete their fields, or give them to a signer before them.`;
      } else if (own.filter((f) => f.type === 'aadhaar').length > 1) {
        problems[`fields.${r.id}`] =
          `${name} can have one Aadhaar seal position. Delete the extra box.`;
      }
      continue;
    }
    if (own.some((f) => f.type === 'aadhaar')) {
      problems[`fields.${r.id}`] =
        `Only a signer who uses Aadhaar eSign can have an Aadhaar seal position. Delete the one given to ${name}.`;
      continue;
    }
    if (!own.some((f) => f.type === 'signature' && f.required)) {
      problems[`fields.${r.id}`] =
        `Place a signature field for ${name}: pick them, then drag "Signature" onto the page.`;
    }
  }
  return problems;
}

/**
 * Where the Aadhaar eSign goes, as the send flow tells the sender for such a signer: at the
 * Aadhaar seal position they placed, unless placing it is turned off for the Leegality
 * account in use, and otherwise where the Leegality workflow says.
 */
export function aadhaarPlacementNote(input: { placed: boolean; supported?: boolean }): string {
  const { placed, supported } = input;
  if (placed && supported !== false) {
    return 'Leegality draws the Aadhaar signature in the Aadhaar seal position you placed. Nothing else is added to the file, and the signer fills in nothing.';
  }
  if (placed) {
    return 'You placed an Aadhaar seal position, but placing it is turned off for the Leegality account in use, so Leegality places the signature where its workflow says.';
  }
  if (supported === false) {
    return "Leegality places the Aadhaar signature where your Leegality workflow says (set the signature position in the workflow). You don't place a box.";
  }
  return 'Leegality places the Aadhaar signature where your Leegality workflow says. To choose the spot, place the optional Aadhaar seal position on the page.';
}

export function settingsProblems(settings: DraftSettings): Problems {
  const problems: Problems = {};
  const title = settings.title.trim();
  if (!title) problems.title = 'Give the envelope a title; recipients see it in the email subject.';
  else if (title.length > TITLE_MAX)
    problems.title = `Keep the title under ${TITLE_MAX} characters.`;
  if (settings.message.length > MESSAGE_MAX) {
    problems.message = `Keep the message under ${MESSAGE_MAX} characters.`;
  }
  if ((settings.changeNote ?? '').length > CHANGE_NOTE_MAX) {
    problems.changeNote = `Keep the note under ${CHANGE_NOTE_MAX} characters.`;
  }
  if (
    !Number.isInteger(settings.expiresInDays) ||
    settings.expiresInDays < 1 ||
    settings.expiresInDays > 365
  ) {
    problems.expiresInDays = 'Pick an expiry between 1 and 365 days.';
  }
  return problems;
}

export function stepProblems(step: StepKey, state: SendFlowState): Problems {
  switch (step) {
    case 'documents':
      return documentProblems(state.documents);
    case 'recipients':
      return { ...recipientProblems(state.recipients), ...aadhaarProblems(state) };
    case 'fields':
      return fieldProblems(state.recipients, state.fields);
    case 'review':
      return {
        ...documentProblems(state.documents),
        ...recipientProblems(state.recipients),
        ...aadhaarProblems(state),
        ...fieldProblems(state.recipients, state.fields),
        ...settingsProblems(state.settings),
      };
  }
}

/** The recipients as the sign API expects them; `key` lets fields point at unsaved ones. */
export function recipientsBody(state: SendFlowState) {
  return state.recipients.map((r, i) => {
    const phone = r.phone.replace(/[\s()-]/g, '');
    return {
      key: r.id,
      ...(r.saved ? { id: r.id } : {}),
      name: r.name.trim(),
      email: r.email.trim().toLowerCase(),
      ...(phone ? { phone } : {}),
      role: r.role,
      auth: r.auth,
      order: state.routing === 'parallel' ? 1 : i + 1,
    };
  });
}

export function fieldsBody(state: SendFlowState) {
  const ids = new Set(state.recipients.filter((r) => r.role !== 'viewer').map((r) => r.id));
  return state.fields
    .filter((f) => ids.has(f.recipientId))
    .map((f) => ({
      document: f.documentId,
      recipient: f.recipientId,
      type: f.type,
      page: f.page,
      rect: f.rect,
      required: f.required,
      ...(f.label ? { label: f.label } : {}),
    }));
}

export function settingsBody(settings: DraftSettings, fallbackTitle: string) {
  const reminders =
    settings.remindEveryDays > 0
      ? { firstAfterDays: settings.remindEveryDays, everyDays: settings.remindEveryDays, max: 5 }
      : { firstAfterDays: 0, everyDays: 1, max: 0 };
  return {
    title: settings.title.trim() || fallbackTitle,
    message: settings.message.trim() ? settings.message.trim() : null,
    ...(settings.changeNote !== undefined
      ? { changeNote: settings.changeNote.trim() ? settings.changeNote.trim() : null }
      : {}),
    expiresInDays: settings.expiresInDays,
    reminders,
  };
}

/** The full draft for `PATCH /v1/envelopes/:id`. */
export function draftBody(state: SendFlowState) {
  const fallback = state.documents[0] ? titleFromFileName(state.documents[0].name) : 'Untitled';
  return {
    ...settingsBody(state.settings, fallback),
    routing: state.routing,
    recipients: recipientsBody(state),
    fields: fieldsBody(state),
  };
}

/**
 * After a save, recipients that were unsaved in `sent` (the list as it went out) take the ids
 * the server gave them, matched by position, and their fields follow. Changes made while the
 * save was in flight are kept.
 */
export function adoptSavedRecipients(
  state: SendFlowState,
  sent: DraftRecipient[],
  saved: { id: string }[],
): SendFlowState {
  const map = new Map<string, string>();
  sent.forEach((r, i) => {
    const id = saved[i]?.id;
    if (id) map.set(r.id, id);
  });
  const changes = state.recipients.some(
    (r) => map.has(r.id) && (map.get(r.id) !== r.id || !r.saved),
  );
  // Returning the same object when nothing changed keeps a save from triggering another.
  if (!changes) return state;
  return {
    ...state,
    recipients: state.recipients.map((r) =>
      map.has(r.id) ? { ...r, id: map.get(r.id)!, saved: true } : r,
    ),
    fields: state.fields.map((f) =>
      map.has(f.recipientId) ? { ...f, recipientId: map.get(f.recipientId)! } : f,
    ),
  };
}

/** Points a server path like `recipients[1].email` at the form field it belongs to. */
export function localPath(path: string | undefined, sent: DraftRecipient[]): string | undefined {
  if (!path) return undefined;
  const match = /^recipients\[(\d+)\]\.?(.*)$/.exec(path);
  if (!match) return path;
  const recipient = sent[Number(match[1])];
  if (!recipient) return 'recipients';
  return match[2] ? `recipients.${recipient.id}.${match[2]}` : `recipients.${recipient.id}`;
}

export const moveItem = <T>(list: T[], from: number, to: number): T[] => {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
};

/** The send flow's state for a saved draft, so it can be picked up where it was left. */
export function stateFromEnvelope(envelope: Envelope, now: Date = new Date()): SendFlowState {
  const days = envelope.expiresAt
    ? Math.round((Date.parse(envelope.expiresAt) - now.getTime()) / 86_400_000)
    : 30;
  return {
    envelopeId: envelope.id,
    documents: envelope.documents.map((d) => ({
      id: d.id,
      name: d.name,
      size: 0,
      pages: d.pageSizes ?? [],
    })),
    recipients: envelope.recipients
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((r) => ({
        id: r.id,
        saved: true,
        name: r.name,
        email: r.email ?? '',
        phone: r.phone ?? '',
        role: r.role,
        auth: r.auth,
      })),
    routing: envelope.routing,
    fields: envelope.fields,
    settings: {
      title: envelope.title,
      message: envelope.message ?? '',
      ...(envelope.changeNote !== undefined ? { changeNote: envelope.changeNote } : {}),
      expiresInDays: Math.min(365, Math.max(1, days)),
      remindEveryDays: envelope.reminders.firstAfterDays > 0 ? envelope.reminders.everyDays : 0,
    },
  };
}

/**
 * Takes a replaced document from the server into the flow: its name and pages, and the fields
 * as the server placed them.
 */
export function withReplacedDocument(
  state: SendFlowState,
  envelope: Envelope,
  documentId: string,
): SendFlowState {
  const saved = envelope.documents.find((d) => d.id === documentId);
  if (!saved) return state;
  return {
    ...state,
    documents: state.documents.map((d) =>
      d.id === documentId
        ? { id: d.id, name: saved.name, size: 0, pages: saved.pageSizes ?? [] }
        : d,
    ),
    fields: envelope.fields,
  };
}

/** Where to pick up a draft: the first step that still needs something. */
export function resumeStep(state: SendFlowState): StepKey {
  for (const step of ['documents', 'recipients', 'fields'] as const) {
    if (Object.keys(stepProblems(step, state)).length > 0) return step;
  }
  return 'review';
}

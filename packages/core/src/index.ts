export * from './types';
export * from './ports';

export {
  addDocument,
  addField,
  addRecipient,
  assertReadyToSend,
  createEnvelope,
  DEFAULT_REMINDERS,
  isActor,
  moveField,
  prefillFields,
  removeDocument,
  removeField,
  removeRecipient,
  updateEnvelope,
  updateRecipient,
  validateForSend,
} from './builder';
export type {
  CreateEnvelopeInput,
  DocumentInput,
  EnvelopePatch,
  FieldInput,
  FieldMove,
  RecipientInput,
  RecipientPatch,
} from './builder';

export {
  addDocumentWithEvents,
  addFieldWithEvents,
  addRecipientWithEvents,
  moveFieldWithEvents,
  prefillFieldsWithEvents,
  removeDocumentWithEvents,
  removeFieldWithEvents,
  removeRecipientWithEvents,
  updateEnvelopeWithEvents,
  updateRecipientWithEvents,
} from './edits';
export type { DraftChange, DraftEditDeps, DraftEditOptions } from './edits';

export {
  correctRecipient,
  decline,
  markAuthenticated,
  markViewed,
  MIN_REMINDER_INTERVAL_MS,
  recall,
  RECALL_REASON,
  recordSeal,
  remind,
  send,
  shareLink,
  submit,
  tick,
  voidEnvelope,
} from './workflow';
export { recallCopy, type RecallCopyOptions } from './recall';
export type {
  AuthenticatedInput,
  DeclineInput,
  RecallInput,
  RecipientAction,
  RecipientCorrection,
  RemindInput,
  ShareLinkInput,
  SealInput,
  SubmitInput,
  VoidInput,
  WorkflowDeps,
} from './workflow';

export {
  currentRecipients,
  hasActed,
  isActive,
  isExpiredAt,
  isFinal,
  nextReminderAt,
  nextTickAt,
} from './routing';

export {
  appendEvents,
  canonicalize,
  commitTransition,
  GENESIS_HASH,
  hashEvent,
  verifyChain,
} from './audit';
export type { ChainVerification, CommittedTransition, VerifyChainOptions } from './audit';

export {
  createOtp,
  createSigningToken,
  hashToken,
  isSigningTokenShape,
  OTP_DIGITS,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
  SIGNING_TOKEN_BYTES,
  verifyOtp,
  verifyToken,
} from './security';
export type { IssuedOtp, OtpCheck, OtpFailureCode, OtpState, SigningToken } from './security';

export {
  checkFieldValue,
  isIsoDate,
  isValidEmail,
  isValidPhone,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_NAME_LENGTH,
  MAX_REASON_LENGTH,
  MAX_TEXT_LENGTH,
  pageSizeIssues,
  PREFILLABLE_FIELD_TYPES,
  rectIssues,
  reminderIssues,
  validationError,
} from './validation';
export type { ValidationIssue } from './validation';

export { cryptoRandom, randomIds, systemClock, webCryptoHasher } from './defaults';

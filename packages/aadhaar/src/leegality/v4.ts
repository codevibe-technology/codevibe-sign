import { randomUUID } from 'node:crypto';
import { SignError } from '@codevibe_technology/sign-core';
import { isRecord, PROVIDER } from './api';
import { toLeegalityRect, type CoordinateMapping } from './coordinates';
import type { SignaturePosition } from '../provider';

/**
 * A published Leegality v4 workflow to send through when the sender placed the signature.
 *
 * The v4 Pack API refers to every part of the pack by a UUID. Parts the workflow already has
 * keep the UUIDs Leegality gave them; parts added while sending get new ones
 * (https://knowledge.leegality.com/document-execution/api/create-pack-sync). The workflow's
 * "Download API Payload" file holds the first kind
 * (https://knowledge.leegality.com/document-execution/api/download-v4-api-payload); read them
 * with `leegalityV4WorkflowFromPayload`. Ids left out are generated per request.
 */
export interface LeegalityV4Workflow {
  /** The full workflow id (the dashboard shows only its first eight characters). */
  workflowId: string;
  documentUuid?: string;
  subDocumentUuid?: string;
  inviteeUuid?: string;
  inviteeDetailsUuid?: string;
  combinationUuid?: string;
  assignedDocumentUuid?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORKFLOW_ID = /^[A-Za-z0-9-]{8,64}$/;

const first = (value: unknown): Record<string, unknown> | undefined => {
  if (!Array.isArray(value)) return undefined;
  const item: unknown = value[0];
  return isRecord(item) ? item : undefined;
};

const uuidOf = (record: Record<string, unknown> | undefined): string | undefined =>
  typeof record?.uuid === 'string' && UUID.test(record.uuid) ? record.uuid : undefined;

function invalidPayload(message: string): SignError {
  return new SignError('VALIDATION', message, { option: 'v4' });
}

/**
 * Reads the workflow id and the ids of its first document, sub-document, signer and
 * combination from the JSON of a workflow's downloaded API payload. Nothing else of the
 * file is kept, so settings the file may carry never reach the configuration.
 */
export function leegalityV4WorkflowFromPayload(payload: unknown): LeegalityV4Workflow {
  let body = payload;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      throw invalidPayload('The Leegality API payload is not JSON');
    }
  }
  if (!isRecord(body)) throw invalidPayload('The Leegality API payload is not a JSON object');
  const { workflowId } = body;
  if (typeof workflowId !== 'string' || !WORKFLOW_ID.test(workflowId)) {
    throw invalidPayload('The Leegality API payload has no workflowId');
  }
  const document = first(body.documents);
  const signer =
    (Array.isArray(body.invitees) ? body.invitees : [])
      .filter(isRecord)
      .find((i) => i.type === 'signer') ?? first(body.invitees);
  const combination = first(signer?.combinations);
  const ids: LeegalityV4Workflow = { workflowId };
  const set = (key: Exclude<keyof LeegalityV4Workflow, 'workflowId'>, value?: string) => {
    if (value) ids[key] = value;
  };
  set('documentUuid', uuidOf(document));
  set('subDocumentUuid', uuidOf(first(document?.subDocuments)));
  set('inviteeUuid', uuidOf(signer));
  set('inviteeDetailsUuid', uuidOf(first(signer?.inviteeDetails)));
  set('combinationUuid', uuidOf(combination));
  set('assignedDocumentUuid', uuidOf(first(combination?.assignedDocuments)));
  return ids;
}

/** Checks a configured workflow, so a typo fails when the provider is created. */
export function checkV4Workflow(workflow: LeegalityV4Workflow): LeegalityV4Workflow {
  if (!isRecord(workflow) || typeof workflow.workflowId !== 'string') {
    throw invalidPayload('Leegality option v4.workflowId is required');
  }
  if (!WORKFLOW_ID.test(workflow.workflowId)) {
    throw invalidPayload('Leegality option v4.workflowId is not a Leegality workflow id');
  }
  for (const [key, value] of Object.entries(workflow)) {
    if (key === 'workflowId' || value === undefined) continue;
    if (typeof value !== 'string' || !UUID.test(value)) {
      throw invalidPayload(`Leegality option v4.${key} must be a UUID`);
    }
  }
  return workflow;
}

export interface PackInput {
  workflow: LeegalityV4Workflow;
  reference: string;
  documentName: string;
  fileBase64: string;
  invitee: { name: string; email?: string; phone?: string };
  positions: SignaturePosition[];
  mapping: CoordinateMapping;
  callbackUrl: string;
  redirectUrl: string;
}

export interface PackRequest {
  body: Record<string, unknown>;
  inviteeDetailsUuid: string;
}

/**
 * The body of `POST /api/v4/pack/sync`
 * (https://knowledge.leegality.com/document-execution/api/create-pack-sync): one document of
 * one PDF, one Aadhaar eSign signer, and the signer's appearances at the given positions.
 * Webhooks are set per combination and use version 4.0, whose `mac` signs the document id
 * (https://knowledge.leegality.com/document-execution/api/webhooks-v4/webhook-v4-introduction).
 */
export function packRequest(input: PackInput): PackRequest {
  const { workflow } = input;
  const documentUuid = workflow.documentUuid ?? randomUUID();
  const subDocumentUuid = workflow.subDocumentUuid ?? randomUUID();
  const inviteeUuid = workflow.inviteeUuid ?? randomUUID();
  const inviteeDetailsUuid = workflow.inviteeDetailsUuid ?? randomUUID();
  const combinationUuid = workflow.combinationUuid ?? randomUUID();
  const assignedDocumentUuid = workflow.assignedDocumentUuid ?? randomUUID();

  const details: Record<string, string> = {
    uuid: inviteeDetailsUuid,
    inviteeName: input.invitee.name,
  };
  if (input.invitee.email) details.inviteeEmail = input.invitee.email;
  if (input.invitee.phone) details.inviteePhone = input.invitee.phone;

  const body = {
    workflowId: workflow.workflowId,
    pack: { packName: input.documentName, packIrn: input.reference, packUrn: input.reference },
    documents: [
      {
        uuid: documentUuid,
        documentName: input.documentName,
        irn: input.reference,
        subDocuments: [{ uuid: subDocumentUuid, file: input.fileBase64 }],
      },
    ],
    invitees: [
      {
        uuid: inviteeUuid,
        type: 'signer',
        level: 1,
        inviteeDetails: [details],
        inviteeSettings: { manageInviteInteractions: { redirectUrl: input.redirectUrl } },
        combinations: [
          {
            uuid: combinationUuid,
            assignedDocuments: [{ uuid: assignedDocumentUuid, documentUuid, role: 'signer' }],
            combinationSettings: {
              esignTypes: {
                aadharEsign: {
                  aadharEsignEnabled: true,
                  aadhaarEsignConfig: { aadhaarOtp: true },
                },
              },
              webhooks: {
                successWebhook: input.callbackUrl,
                errorWebhook: input.callbackUrl,
                webhookVersion: 'VERSION_4.0',
              },
            },
          },
        ],
      },
    ],
    coordinates: [
      {
        uuid: randomUUID(),
        inviteeUuid,
        appearances: input.positions.map((position) => ({
          uuid: randomUUID(),
          documentUuid,
          subDocumentUuid,
          combinationUuid,
          // 1-indexed, as a string (create-pack-sync, `appearances.pageNo`).
          pageNo: String(position.page + 1),
          rect: toLeegalityRect(position, input.mapping),
          type: 'CUSTOM',
          subDocumentType: 'PDF',
        })),
      },
    ],
  };
  return { body, inviteeDetailsUuid };
}

/** `providerRef` of a v4 request: the pack, which the status API needs, and its document. */
export const V4_REF_PREFIX = 'v4:';

export function v4Ref(packId: string, documentId: string): string {
  return `${V4_REF_PREFIX}${packId}:${documentId}`;
}

export function parseV4Ref(ref: string): { packId: string; documentId: string } | null {
  if (!ref.startsWith(V4_REF_PREFIX)) return null;
  const [packId, documentId, ...rest] = ref.slice(V4_REF_PREFIX.length).split(':');
  if (!packId || !documentId || rest.length > 0) return null;
  return { packId, documentId };
}

export interface V4Error {
  code?: string;
  message?: string;
  errors?: { code?: string; message?: string }[];
}

export interface PackCreated {
  code?: string;
  message?: string;
  data?: {
    pack?: { packId?: string };
    documents?: { documentId?: string }[];
    invitations?: {
      inviteeDetails?: { uuid?: string; invitationUrl?: string }[];
    }[];
  };
}

export interface PackDetails {
  data?: {
    pack?: { packId?: string; status?: string };
    documents?: { documentId?: string; status?: string }[];
    invitations?: {
      inviteeType?: string;
      inviteeDetails?: {
        invitationUrl?: string;
        inviteeName?: string;
        invitationStatus?: { status?: string; failureReason?: string | null };
      }[];
    }[];
  };
}

/** A v4 error body (`{ code, errors[] }`) as a `SignError` carrying Leegality's codes. */
export function v4Error(body: unknown, fallback: string): SignError {
  const value: V4Error = isRecord(body) ? (body as V4Error) : {};
  const errors = Array.isArray(value.errors) ? value.errors.filter(isRecord) : [];
  const codes = [value.code, ...errors.map((e) => e.code)].filter(
    (c, i, all): c is string => typeof c === 'string' && all.indexOf(c) === i,
  );
  const message =
    errors.find((e) => typeof e.message === 'string')?.message ??
    (typeof value.message === 'string' ? value.message : undefined);
  return new SignError('PROVIDER_ERROR', message ? `${PROVIDER}: ${message}` : fallback, {
    provider: PROVIDER,
    // LE_ERR_AP_001: no document matches (download-files, 404).
    reason: codes.includes('LE_ERR_AP_001') ? 'not_found' : 'rejected',
    providerCodes: codes,
    retryable: false,
  });
}

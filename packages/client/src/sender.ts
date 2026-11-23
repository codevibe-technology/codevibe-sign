import { encodeMultipart } from './multipart';
import { path, Transport, type RequestOptions, type TransportOptions } from './http';
import type {
  Certificate,
  CreateEnvelopeInput,
  CreateTemplateInput,
  DocumentUpload,
  DocumentVersion,
  Envelope,
  EnvelopeEvents,
  EnvelopeFromTemplateInput,
  RecipientCorrection,
  Template,
  TemplateList,
  TemplateListQuery,
  UpdateEnvelopeInput,
  UpdateTemplateInput,
} from './types';
import { verifyCalls, type VerifyClient } from './verify';

export interface SignClientOptions extends TransportOptions {
  /** A sender API key, sent as `Authorization: Bearer <key>`. Keep it on your server. */
  apiKey: string;
}

export interface SignClient {
  envelopes: {
    /** Uploads the PDFs and creates a draft, or sends it at once with `send: true`. */
    create(input: CreateEnvelopeInput, options?: RequestOptions): Promise<Envelope>;
    get(id: string, options?: RequestOptions): Promise<Envelope>;
    /** Changes a draft. Recipients and fields, when given, replace the existing ones. */
    update(id: string, patch: UpdateEnvelopeInput, options?: RequestOptions): Promise<Envelope>;
    send(id: string, options?: RequestOptions): Promise<Envelope>;
    void(id: string, reason: string, options?: RequestOptions): Promise<Envelope>;
    /**
     * A fresh signing link for a recipient whose turn it is, to pass on yourself; no email is
     * sent and their earlier links stop working. Treat the URL like a password.
     */
    shareLink(
      id: string,
      recipientId: string,
      options?: RequestOptions,
    ): Promise<{ recipientId: string; url: string }>;
    /** Corrects the name, email or phone of a recipient who has not acted yet. */
    correctRecipient(
      id: string,
      recipientId: string,
      correction: RecipientCorrection,
      options?: RequestOptions,
    ): Promise<Envelope>;
    /** Voids a sent envelope and returns a draft copy to edit and send again. */
    recall(
      id: string,
      note?: string,
      options?: RequestOptions,
    ): Promise<{ draft: Envelope; recalled: Envelope }>;
    /** Copies a declined envelope to a new draft; the declined one stays as it is. */
    revise(id: string, options?: RequestOptions): Promise<{ draft: Envelope; declined: Envelope }>;
    /** The audit log and whether its hash chain is intact. */
    events(id: string, options?: RequestOptions): Promise<EnvelopeEvents>;
    /**
     * The PDF. Without a version: the sealed file once the envelope is complete, else the
     * original. Asking for `sealed` before sealing fails with `INVALID_STATE`.
     */
    downloadDocument(
      id: string,
      documentId: string,
      options?: RequestOptions & { version?: DocumentVersion },
    ): Promise<Uint8Array>;
    certificate(id: string, options?: RequestOptions): Promise<Certificate>;
  };
  templates: {
    /** One page of the workspace's templates, newest first. */
    list(query?: TemplateListQuery, options?: RequestOptions): Promise<TemplateList>;
    /** Uploads the PDFs and stores them with the roles, fields and settings. */
    create(input: CreateTemplateInput, options?: RequestOptions): Promise<Template>;
    get(id: string, options?: RequestOptions): Promise<Template>;
    /** Roles and fields, when given, replace the existing ones. Documents cannot change. */
    update(id: string, patch: UpdateTemplateInput, options?: RequestOptions): Promise<Template>;
    /** Removes the template and its PDFs. Envelopes already made from it are not affected. */
    delete(id: string, options?: RequestOptions): Promise<void>;
    /**
     * Makes an envelope from the template with a person for every role, a draft unless
     * `send` is true. `prefill` sets text fields by label or id.
     */
    createEnvelope(
      id: string,
      input: EnvelopeFromTemplateInput,
      options?: RequestOptions,
    ): Promise<Envelope>;
  };
  /** Public verification of sealed PDFs. These calls send no API key. */
  verify: VerifyClient;
}

export function createSignClient(options: SignClientOptions): SignClient {
  if (!options.apiKey) throw new TypeError('apiKey is required');
  const http = new Transport(options);
  const headers = { authorization: `Bearer ${options.apiKey}` };

  return {
    envelopes: {
      async create(input, requestOptions) {
        return http.json({
          method: 'POST',
          path: '/v1/envelopes',
          body: await multipart(input),
          headers,
          options: requestOptions,
        });
      },
      get: (id, requestOptions) =>
        http.json({
          method: 'GET',
          path: path`/v1/envelopes/${id}`,
          headers,
          options: requestOptions,
        }),
      update: (id, patch, requestOptions) =>
        http.json({
          method: 'PATCH',
          path: path`/v1/envelopes/${id}`,
          json: toWire(patch),
          headers,
          options: requestOptions,
        }),
      send: (id, requestOptions) =>
        http.json({
          method: 'POST',
          path: path`/v1/envelopes/${id}/send`,
          headers,
          options: requestOptions,
        }),
      void: (id, reason, requestOptions) =>
        http.json({
          method: 'POST',
          path: path`/v1/envelopes/${id}/void`,
          json: { reason },
          headers,
          options: requestOptions,
        }),
      shareLink: (id, recipientId, requestOptions) =>
        http.json({
          method: 'POST',
          path: path`/v1/envelopes/${id}/recipients/${recipientId}/link`,
          headers,
          options: requestOptions,
        }),
      correctRecipient: (id, recipientId, correction, requestOptions) =>
        http.json({
          method: 'PATCH',
          path: path`/v1/envelopes/${id}/recipients/${recipientId}`,
          json: correction,
          headers,
          options: requestOptions,
        }),
      recall: (id, note, requestOptions) =>
        http.json({
          method: 'POST',
          path: path`/v1/envelopes/${id}/recall`,
          json: note ? { note } : {},
          headers,
          options: requestOptions,
        }),
      revise: (id, requestOptions) =>
        http.json({
          method: 'POST',
          path: path`/v1/envelopes/${id}/revise`,
          headers,
          options: requestOptions,
        }),
      events: (id, requestOptions) =>
        http.json({
          method: 'GET',
          path: path`/v1/envelopes/${id}/events`,
          headers,
          options: requestOptions,
        }),
      downloadDocument: (id, documentId, requestOptions) =>
        http.bytes({
          method: 'GET',
          path: path`/v1/envelopes/${id}/documents/${documentId}`,
          query: { version: requestOptions?.version },
          headers: { ...headers, accept: 'application/pdf' },
          options: requestOptions,
        }),
      certificate: (id, requestOptions) =>
        http.json({
          method: 'GET',
          path: path`/v1/envelopes/${id}/certificate`,
          headers,
          options: requestOptions,
        }),
    },
    templates: {
      list: (query = {}, requestOptions) =>
        http.json({
          method: 'GET',
          path: '/v1/templates',
          query: {
            q: query.q,
            limit: query.limit === undefined ? undefined : String(query.limit),
            cursor: query.cursor,
          },
          headers,
          options: requestOptions,
        }),
      async create(input, requestOptions) {
        const { documents, ...rest } = input;
        return http.json({
          method: 'POST',
          path: '/v1/templates',
          body: await upload('template', rest, documents),
          headers,
          options: requestOptions,
        });
      },
      get: (id, requestOptions) =>
        http.json({
          method: 'GET',
          path: path`/v1/templates/${id}`,
          headers,
          options: requestOptions,
        }),
      update: (id, patch, requestOptions) =>
        http.json({
          method: 'PATCH',
          path: path`/v1/templates/${id}`,
          json: patch,
          headers,
          options: requestOptions,
        }),
      async delete(id, requestOptions) {
        await http.json({
          method: 'DELETE',
          path: path`/v1/templates/${id}`,
          headers,
          options: requestOptions,
        });
      },
      createEnvelope: (id, input, requestOptions) =>
        http.json({
          method: 'POST',
          path: path`/v1/templates/${id}/envelopes`,
          json: toWire(input),
          headers,
          options: requestOptions,
        }),
    },
    verify: verifyCalls(http),
  };
}

function toWire(input: { expiresAt?: string | Date }) {
  const out: Record<string, unknown> = { ...input };
  if (input.expiresAt instanceof Date) out.expiresAt = input.expiresAt.toISOString();
  return out;
}

function multipart(input: CreateEnvelopeInput) {
  const { documents, ...rest } = input;
  return upload('envelope', toWire(rest), documents);
}

/** The JSON in a form field named `part`, with each document's key and name, then the files. */
function upload(part: 'envelope' | 'template', json: object, documents: DocumentUpload[]) {
  const described = {
    ...json,
    documents: documents.map((d, i) => ({ key: d.key ?? String(i), name: d.name })),
  };
  return encodeMultipart(
    { name: part, json: JSON.stringify(described) },
    documents.map((d) => ({ name: 'documents', content: d.content })),
  );
}

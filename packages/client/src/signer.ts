import { path, Transport, type RequestOptions, type TransportOptions } from './http';
import type { FieldValue, OtpSent, OtpSession, SignerActionResult, SigningSession } from './types';

export interface SignerClientOptions extends TransportOptions {
  /**
   * The token from the signing link (`/sign/<token>`), or `'link'` when the server has moved
   * it into its HttpOnly cookie (same-origin pages only).
   */
  token: string;
  /** A session from an earlier `verifyOtp`, for example kept in `sessionStorage`. */
  sessionToken?: string;
}

export interface SignerClient {
  /** The envelope basics and this signer's fields. Works before the OTP check. */
  session(options?: RequestOptions): Promise<SigningSession>;
  /** The original PDF. OTP signers must verify first. */
  document(documentId: string, options?: RequestOptions): Promise<Uint8Array>;
  /** Sends a one-time code to the signer's email or phone. */
  requestOtp(options?: RequestOptions): Promise<OtpSent>;
  /** Checks the code; later calls carry the session it returns. */
  verifyOtp(code: string, options?: RequestOptions): Promise<OtpSession>;
  /** Records that the signer opened the document. */
  view(options?: RequestOptions): Promise<SignerActionResult>;
  /** Signs with these values. Calling it is the signer's consent to sign electronically. */
  submit(values: FieldValue[], options?: RequestOptions): Promise<SignerActionResult>;
  decline(reason: string, options?: RequestOptions): Promise<SignerActionResult>;
  /** The current OTP session, if any. */
  readonly sessionToken: string | undefined;
}

export function createSignerClient(options: SignerClientOptions): SignerClient {
  if (!options.token) throw new TypeError('token is required');
  const http = new Transport(options);
  const base = path`/v1/sign/${options.token}`;
  let sessionToken = options.sessionToken;

  const headers = (): Record<string, string> =>
    sessionToken ? { 'x-sign-session': sessionToken } : {};
  const post = <T>(suffix: string, json: unknown, requestOptions?: RequestOptions) =>
    http.json<T>({
      method: 'POST',
      path: base + suffix,
      ...(json === undefined ? {} : { json }),
      headers: headers(),
      options: requestOptions,
    });

  return {
    session: (requestOptions) =>
      http.json({
        method: 'GET',
        path: base,
        headers: headers(),
        options: requestOptions,
      }),
    document: (documentId, requestOptions) =>
      http.bytes({
        method: 'GET',
        path: base + path`/documents/${documentId}`,
        headers: { ...headers(), accept: 'application/pdf' },
        options: requestOptions,
      }),
    requestOtp: (requestOptions) => post('/otp', undefined, requestOptions),
    async verifyOtp(code, requestOptions) {
      const session = await post<OtpSession>('/otp/verify', { code }, requestOptions);
      sessionToken = session.sessionToken;
      return session;
    },
    view: (requestOptions) => post('/view', undefined, requestOptions),
    submit: (values, requestOptions) =>
      post(
        '/submit',
        { consent: true, values: values.map(({ fieldId, value }) => ({ fieldId, value })) },
        requestOptions,
      ),
    decline: (reason, requestOptions) => post('/decline', { reason }, requestOptions),
    get sessionToken() {
      return sessionToken;
    },
  };
}

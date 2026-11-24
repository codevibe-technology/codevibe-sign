import { toLeegalityRect, type CoordinateMapping } from './coordinates';
import type { SignaturePosition } from '../provider';

/**
 * The 2.1 Create API's signature appearance: `x1`/`y1` the lower-left and `x2`/`y2` the
 * upper-right corner in whole numbers, `page` a page list such as `'1,2,5'` (1-based)
 * (v2.1 OpenAPI schema `Appearance`, published copy at
 * https://github.com/prakharmittal/leegality-apidocs/blob/master/api_2_1.json).
 */
export interface V21Appearance {
  page: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function v21Appearances(
  positions: SignaturePosition[],
  mapping: CoordinateMapping,
): V21Appearance[] {
  return positions.map((position) => {
    const rect = toLeegalityRect(position, mapping);
    return {
      page: String(position.page + 1),
      x1: Number(rect.x1Axis),
      y1: Number(rect.y1Axis),
      x2: Number(rect.x2Axis),
      y2: Number(rect.y2Axis),
    };
  });
}

export interface V21Input {
  reference: string;
  documentName: string;
  fileBase64: string;
  invitee: { name: string; email?: string; phone?: string };
  positions: SignaturePosition[];
  mapping: CoordinateMapping;
  callbackUrl: string;
  redirectUrl: string;
}

/**
 * The body of `POST /api/v2.1/sign/request`, the one Create API that takes each invitee's
 * `appearances` ("pass the eSign coordinates in the appearances array of the payload",
 * https://knowledge.leegality.com/document-execution/leegality-features/signature-coordinate/coordinate-picker).
 * It takes no workflow: the request itself asks for Aadhaar eSign by OTP, sets the success and
 * failure webhooks to version 2.5, the format the v3.0 workflow sends, and the redirect URL.
 */
export function v21Request(input: V21Input): Record<string, unknown> {
  const invitee: Record<string, unknown> = { name: input.invitee.name };
  if (input.invitee.email) invitee.email = input.invitee.email;
  if (input.invitee.phone) invitee.phone = input.invitee.phone;
  invitee.appearances = v21Appearances(input.positions, input.mapping);
  invitee.signatures = [{ type: 'AADHAAR', config: { authTypes: ['OTP'] } }];
  invitee.webhook = { success: input.callbackUrl, failure: input.callbackUrl, version: 2.5 };
  invitee.redirectUrl = input.redirectUrl;
  return {
    file: { name: input.documentName, file: input.fileBase64 },
    invitees: [invitee],
    irn: input.reference,
  };
}

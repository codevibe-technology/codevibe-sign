import 'server-only';
import { readFileSync, statSync } from 'node:fs';
import {
  LEEGALITY_DEFAULT_COORDINATES,
  leegalityV4WorkflowFromPayload,
  parseLeegalityCoordinateOrigin,
  parseLeegalityCoordinateUnits,
  type LeegalityCoordinateMapping,
  type LeegalityV4Workflow,
} from '@codevibe_technology/sign-aadhaar';
import { SignError } from '@codevibe_technology/sign-core';

type Source = Record<string, string | undefined>;

const read = (source: Source, name: string) => {
  const value = source[name]?.trim();
  return value === '' ? undefined : value;
};

const problem = (error: unknown) =>
  error instanceof SignError || error instanceof Error ? error.message : String(error);

/**
 * `LEEGALITY_COORDINATE_UNITS` (`points` or `pixels@<dpi>`, default `points`) and
 * `LEEGALITY_COORDINATE_ORIGIN` (`bottom-left` or `top-left`, default `bottom-left`): how an
 * Aadhaar seal position becomes Leegality coordinates. Leegality does not document either, so
 * they are confirmed with one test eSign (see the Aadhaar eSign guide). Throws on a value
 * that is neither.
 */
export function leegalityCoordinates(source: Source = process.env): LeegalityCoordinateMapping {
  const units = read(source, 'LEEGALITY_COORDINATE_UNITS');
  const origin = read(source, 'LEEGALITY_COORDINATE_ORIGIN');
  try {
    return {
      units: units ? parseLeegalityCoordinateUnits(units) : LEEGALITY_DEFAULT_COORDINATES.units,
      origin: origin
        ? parseLeegalityCoordinateOrigin(origin)
        : LEEGALITY_DEFAULT_COORDINATES.origin,
    };
  } catch (error) {
    throw new Error(`LEEGALITY_COORDINATE_UNITS / _ORIGIN: ${problem(error)}`, { cause: error });
  }
}

const WORKFLOW_ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * The v4 workflow from what a sender pastes: the full workflow id, or the JSON of the
 * workflow's downloaded API payload, of which only the ids are kept.
 */
export function parseV4Workflow(text: string): LeegalityV4Workflow {
  const value = text.trim();
  if (value.startsWith('{')) return leegalityV4WorkflowFromPayload(value);
  if (!WORKFLOW_ID.test(value)) {
    throw new SignError(
      'VALIDATION',
      'Paste the full V4 workflow ID (Download API Payload shows it) or the whole downloaded file',
    );
  }
  return { workflowId: value };
}

const payloadCache = new Map<string, { mtimeMs: number; workflow: LeegalityV4Workflow }>();

function workflowFromFile(path: string): LeegalityV4Workflow {
  const { mtimeMs } = statSync(path);
  const hit = payloadCache.get(path);
  if (hit && hit.mtimeMs === mtimeMs) return hit.workflow;
  const workflow = leegalityV4WorkflowFromPayload(readFileSync(path, 'utf8'));
  payloadCache.set(path, { mtimeMs, workflow });
  return workflow;
}

/**
 * The install's v4 workflow for the Aadhaar seal position, or null without one:
 * `LEEGALITY_V4_PAYLOAD_FILE`, the path of the workflow's downloaded API payload, and/or
 * `LEEGALITY_V4_WORKFLOW_ID`, its full id. With both, the id must be the file's.
 */
export function leegalityV4FromEnv(source: Source = process.env): LeegalityV4Workflow | null {
  const id = read(source, 'LEEGALITY_V4_WORKFLOW_ID');
  const file = read(source, 'LEEGALITY_V4_PAYLOAD_FILE');
  if (!id && !file) return null;
  let fromFile: LeegalityV4Workflow | null = null;
  if (file) {
    try {
      fromFile = workflowFromFile(file);
    } catch (error) {
      throw new Error(`LEEGALITY_V4_PAYLOAD_FILE could not be read: ${problem(error)}`, {
        cause: error,
      });
    }
  }
  if (id && fromFile && fromFile.workflowId !== id) {
    throw new Error('LEEGALITY_V4_WORKFLOW_ID is not the workflow of LEEGALITY_V4_PAYLOAD_FILE');
  }
  if (fromFile) return fromFile;
  try {
    return parseV4Workflow(id!);
  } catch (error) {
    throw new Error(`LEEGALITY_V4_WORKFLOW_ID ${problem(error)}`, { cause: error });
  }
}

export type PositionApi = 'v2.1' | 'v4' | 'off';
const POSITION_APIS: readonly PositionApi[] = ['v2.1', 'v4', 'off'];

/**
 * `LEEGALITY_POSITION_API`: which Leegality API places the Aadhaar seal position. `v2.1`, the
 * 2.1 Create API with the account's Auth Token, needs no Leegality setup; `v4` needs a V4
 * workflow; `off` leaves the signature where the v3.0 workflow says. Unset: `v4` when the
 * account has a V4 workflow, otherwise `v2.1`. Throws on another value, or `v4` without one.
 */
export function leegalityPositionApi(
  hasV4Workflow: boolean,
  source: Source = process.env,
): PositionApi {
  const raw = read(source, 'LEEGALITY_POSITION_API')?.toLowerCase();
  if (raw === undefined) return hasV4Workflow ? 'v4' : 'v2.1';
  if (!POSITION_APIS.includes(raw as PositionApi)) {
    throw new Error('LEEGALITY_POSITION_API must be v2.1, v4 or off');
  }
  if (raw === 'v4' && !hasV4Workflow) {
    throw new Error('LEEGALITY_POSITION_API is v4 but no V4 workflow is set');
  }
  return raw as PositionApi;
}

/**
 * The position API of a workspace's own Leegality account: v4 when it saved a V4 workflow,
 * otherwise v2.1, unless the install turned placing off. A malformed install setting is
 * reported by the install's billing check, and v2.1 used here.
 */
export function ownPositionApi(hasV4Workflow: boolean, source: Source = process.env): PositionApi {
  if (read(source, 'LEEGALITY_POSITION_API')?.toLowerCase() === 'off') return 'off';
  return hasV4Workflow ? 'v4' : 'v2.1';
}

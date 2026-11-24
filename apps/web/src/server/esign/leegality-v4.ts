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

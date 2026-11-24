import { describe, expect, it } from 'vitest';
import { leegalityCoordinates, leegalityV4FromEnv, parseV4Workflow } from './leegality-v4';

const WORKFLOW = '70843c25-8d80-40ac-ab6b-edba12abd495';

describe('parseV4Workflow', () => {
  it('takes the full workflow id or the downloaded API payload', () => {
    expect(parseV4Workflow(` ${WORKFLOW} `)).toEqual({ workflowId: WORKFLOW });
    expect(
      parseV4Workflow(
        JSON.stringify({
          workflowId: WORKFLOW,
          invitees: [{ uuid: '8bc21487-b200-4130-8240-a5f1715244dc', type: 'signer' }],
        }),
      ),
    ).toEqual({ workflowId: WORKFLOW, inviteeUuid: '8bc21487-b200-4130-8240-a5f1715244dc' });
  });

  it('refuses a short id and a file that is not a payload', () => {
    expect(() => parseV4Workflow('70843c2')).toThrow(/full V4 workflow ID/);
    expect(() => parseV4Workflow('{"pack":{}}')).toThrow(/no workflowId/);
  });
});

describe('the install settings', () => {
  it('needs the id to match the payload file when both are set', () => {
    expect(leegalityV4FromEnv({})).toBeNull();
    expect(() => leegalityV4FromEnv({ LEEGALITY_V4_WORKFLOW_ID: 'bad id' })).toThrow(
      /LEEGALITY_V4_WORKFLOW_ID/,
    );
  });

  it('names the variable of a malformed coordinate setting', () => {
    expect(leegalityCoordinates({})).toEqual({ units: 'points', origin: 'bottom-left' });
    expect(() => leegalityCoordinates({ LEEGALITY_COORDINATE_ORIGIN: 'centre' })).toThrow(
      /LEEGALITY_COORDINATE_UNITS \/ _ORIGIN: Coordinate origin must be/,
    );
  });
});

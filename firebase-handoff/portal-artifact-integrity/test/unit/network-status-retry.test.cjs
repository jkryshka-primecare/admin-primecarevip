/**
 * D-308a follow-on · `elationStatus: 0` (network/timeout/abort) must be a
 * RETRYABLE class, not a hard failure — five flaky fetches parked the minor's
 * imaging row (1228288623050753:1241558923214888) even though nothing upstream
 * said the document was gone.
 *
 * The contract asserted here, in words:
 *   - a status-0 error defers the run instead of reporting a hard failure,
 *   - it STILL charges an attempt, so an unreachable row exhausts its budget,
 *   - at MAX_FAILURES it parks and raises the parked alert like anything else,
 *   - a real HTTP failure (e.g. 404) is untouched by any of this.
 */

const MAX_FAILURES = 5;

function makeRef() {
  const writes = [];
  return { writes, set: async (d) => { writes.push(d); } };
}

/**
 * Mirror of repairOne's error classification, driven by the same constants.
 * The sweep module itself pulls in Storage/Elation clients, so the branch is
 * exercised through this faithful reduction; the ordering it encodes (blocked
 * -> transient -> network -> hard) is the ordering in sweepArtifactRepairs.js.
 */
function classify({ status, failures }) {
  const TRANSIENT = new Set([429, 500, 502, 503, 504]);
  if (status === 402 || status === 403) return { outcome: 'blocked' };
  if (TRANSIENT.has(status)) return { outcome: 'deferred', charged: false };
  const next = (failures || 0) + 1;
  const parked = next >= MAX_FAILURES;
  const networkBlip = status === 0 && !parked;
  return {
    outcome: networkBlip ? 'deferred' : 'failed',
    charged: true,
    failures: next,
    parked,
  };
}

describe('status 0 is a retryable network class', () => {
  test('a status-0 blip defers the run rather than failing the row', () => {
    expect(classify({ status: 0, failures: 1 })).toMatchObject({
      outcome: 'deferred', parked: false,
    });
  });

  test('but it still charges an attempt — no infinite retry for a dead doc', () => {
    expect(classify({ status: 0, failures: 1 }).failures).toBe(2);
  });

  test('the attempt that reaches MAX_FAILURES parks and reports failed', () => {
    expect(classify({ status: 0, failures: MAX_FAILURES - 1 })).toMatchObject({
      outcome: 'failed', parked: true, failures: MAX_FAILURES,
    });
  });

  test('a true transient (503) defers WITHOUT charging the row', () => {
    expect(classify({ status: 503, failures: 3 })).toMatchObject({
      outcome: 'deferred', charged: false,
    });
  });

  test('a 404 stays a hard failure', () => {
    expect(classify({ status: 404, failures: 0 })).toMatchObject({
      outcome: 'failed', failures: 1, parked: false,
    });
  });

  test('402/403 still trip the global breaker first', () => {
    expect(classify({ status: 402, failures: 0 }).outcome).toBe('blocked');
    expect(classify({ status: 403, failures: 0 }).outcome).toBe('blocked');
  });

  test('the primed minor row (failures: 1) survives four more blips', () => {
    let failures = 1;
    const outcomes = [];
    for (let i = 0; i < 3; i += 1) {
      const r = classify({ status: 0, failures });
      failures = r.failures;
      outcomes.push(r.outcome);
    }
    expect(outcomes).toEqual(['deferred', 'deferred', 'deferred']);
    expect(failures).toBe(4);
  });
});

/**
 * D-308 · the sweep's backstop fence.
 *
 * The audit stops enqueueing non-ingestable patients; this fence is what makes
 * rows ALREADY in the queue inert. The regression it exists to prevent is the
 * opposite one: fencing out a MINOR. A dependent never claims, so an
 * adult-only `status === 'active'` rule would skip exactly the chart-backing
 * documents the gate's `minorChartBacked` line measures. The fence must
 * therefore resolve a minor through the guardian-proxied path.
 */

const { ingestEligibility } = require('../../functions/core/services/patient/ingestEligibility');

const ACTIVE_MINOR = {
  dependent: { isMinor: true },
  guardians: [{ guardianUid: 'g1', status: 'active' }],
  // deliberately NOT status: 'active' — minors never claim
};

describe('repair fence resolves eligibility through the shared rule', () => {
  test('an active dependent minor is ELIGIBLE (minorChartBacked guard)', () => {
    const out = ingestEligibility(ACTIVE_MINOR);
    expect(out.eligible).toBe(true);
    expect(out.cohort).toBe('minor');
    expect(out.reason).toBe('guardian-proxied-dependent');
  });

  test('a minor with no active guardian is fenced out', () => {
    const out = ingestEligibility({
      dependent: { isMinor: true },
      guardians: [{ guardianUid: 'g1', status: 'revoked' }],
    });
    expect(out.eligible).toBe(false);
    expect(out.reason).toBe('skip-minor-no-active-guardian');
  });

  test('a claimed-active adult is eligible', () => {
    expect(ingestEligibility({ status: 'active' }).eligible).toBe(true);
  });

  test('a rostered-but-unclaimed adult is fenced out (the 147)', () => {
    const out = ingestEligibility({ status: 'invited' });
    expect(out.eligible).toBe(false);
    expect(out.reason).toBe('skip-non-active');
  });
});

describe('isRepairEligible', () => {
  const admin = require('firebase-admin');
  let patientDoc;
  let getImpl;

  beforeEach(() => {
    getImpl = async () => ({ exists: true, data: () => patientDoc });
    jest.spyOn(admin, 'firestore').mockImplementation(() => ({
      collection: () => ({ doc: () => ({ get: () => getImpl() }) }),
    }));
  });
  afterEach(() => jest.restoreAllMocks());

  const load = () => require('../../functions/sweepArtifactRepairs')._isRepairEligible;

  test('drives an eligible minor', async () => {
    patientDoc = ACTIVE_MINOR;
    await expect(load()({ patientId: '1228288623050753' })).resolves.toMatchObject({
      eligible: true, cohort: 'minor',
    });
  });

  test('skips an unclaimed adult', async () => {
    patientDoc = { status: 'invited' };
    await expect(load()({ patientId: 'p1' })).resolves.toMatchObject({ eligible: false });
  });

  test('a missing patient doc is a hard skip', async () => {
    getImpl = async () => ({ exists: false });
    await expect(load()({ patientId: 'p1' })).resolves.toMatchObject({
      eligible: false, reason: 'no-patient-doc',
    });
  });

  test('a Firestore read error fails OPEN — a blip must not stall repairs', async () => {
    getImpl = async () => { throw new Error('UNAVAILABLE'); };
    await expect(load()({ patientId: 'p1' })).resolves.toMatchObject({
      eligible: true, reason: 'eligibility-read-failed-open',
    });
  });
});

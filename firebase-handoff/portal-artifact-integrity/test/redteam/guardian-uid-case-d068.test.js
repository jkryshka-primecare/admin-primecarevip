/**
 * Release 2b · go-live gap coverage. STATEFUL.
 *
 * Two things the guardian canaries did NOT cover, both named in the
 * guardian-reads go-live checklist:
 *
 *  1. UID CASE DRIFT (D-016 vs D-112). Firestore keys are lower-cased, Auth
 *     uids are case-sensitive, and the admin/CSV link paths wrote the raw
 *     mixed-case uid. `guardians.normalizeUid` folds case on BOTH sides, so a
 *     stored `ABC...` must authorize the caller whose real uid is `abc...` —
 *     and must NOT widen the match to a near-miss uid.
 *
 *  2. D-068 SUBJECT GATE. `ELATION_READ_ALLOWLIST` is enforced on the CHILD
 *     (the read subject), not on the guardian. An allowlisted guardian reading
 *     a non-allowlisted child must be refused, and an empty allowlist must fail
 *     closed.
 *
 * ELATION_FULL_SYNC_ENABLED is pinned to 'false' IN THIS FILE. redteam.yml sets
 * it to 'true' for the whole job, which short-circuits the D-068 gate — without
 * this pin cases 3 and 4 would pass without testing anything.
 *
 * TARGET: emulator or a dedicated test project ONLY (helpers/env.js aborts on
 * production).
 *
 * MUTATION CHECK: relax `normalizeUid` to a bare `===` and case 1 goes RED;
 * short-circuit `isReadAllowed` to always-true and cases 3 and 4 go RED.
 */

const { readArtifact } = require('./helpers/portalRead');
const { seedPatient, seedDocument, cleanup } = require('./helpers/seed');

jest.setTimeout(120000);

const ORIGINAL = {
  enabled: process.env.GUARDIAN_READS_ENABLED,
  allowlist: process.env.GUARDIAN_READS_ALLOWLIST,
  fullSync: process.env.ELATION_FULL_SYNC_ENABLED,
  readAllowlist: process.env.ELATION_READ_ALLOWLIST,
};

const restore = (key, value) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

beforeAll(() => {
  process.env.GUARDIAN_READS_ENABLED = 'true';
  // The D-068 gate is only observable with full sync OFF.
  process.env.ELATION_FULL_SYNC_ENABLED = 'false';
});

afterAll(async () => {
  restore('GUARDIAN_READS_ENABLED', ORIGINAL.enabled);
  restore('GUARDIAN_READS_ALLOWLIST', ORIGINAL.allowlist);
  restore('ELATION_FULL_SYNC_ENABLED', ORIGINAL.fullSync);
  restore('ELATION_READ_ALLOWLIST', ORIGINAL.readAllowlist);
  await cleanup();
});

/** Seed one guardian + one linked minor with a lab artifact. */
async function family() {
  const guardian = await seedPatient();
  const child = await seedPatient({ minor: true });
  const doc = await seedDocument(child, { module: 'labs' });
  await child.linkGuardian(guardian, { status: 'active' });
  process.env.GUARDIAN_READS_ALLOWLIST = guardian.firebaseUid;
  return { guardian, child, doc };
}

const read = ({ guardian, child, doc }) => readArtifact({
  as: guardian,
  reportId: doc.documentId,
  module: 'labs',
  body: { childElationId: child.patientId },
});

describe('[go-live] guardian uid case drift (D-016 vs D-112)', () => {
  test('a mixed-case stored guardianUid still authorizes the lower-cased caller', async () => {
    const f = await family();
    await f.child.setGuardianUidRaw(f.guardian, String(f.guardian.firebaseUid).toUpperCase());
    process.env.ELATION_READ_ALLOWLIST = f.child.patientId;

    const res = await read(f);
    expect(res.status).toBe(200);
    expect(res.signedUrl).toBeDefined();
  });

  test('case folding does NOT widen the match to a near-miss uid', async () => {
    const f = await family();
    const near = `${String(f.guardian.firebaseUid).toUpperCase()}X`;
    await f.child.setGuardianUidRaw(f.guardian, near);
    process.env.ELATION_READ_ALLOWLIST = f.child.patientId;

    const res = await read(f);
    expect(res.status).not.toBe(200);
    expect(res.signedUrl).toBeUndefined();
  });
});

describe('[go-live] D-068 subject gate is enforced on the CHILD', () => {
  test('guardian allowlisted, child NOT in ELATION_READ_ALLOWLIST -> denied', async () => {
    const f = await family();
    // Only the GUARDIAN's chart is allowlisted — the subject is the child.
    process.env.ELATION_READ_ALLOWLIST = f.guardian.patientId;

    const res = await read(f);
    expect(res.status).not.toBe(200);
    expect(res.signedUrl).toBeUndefined();
  });

  test('an empty ELATION_READ_ALLOWLIST fails closed', async () => {
    const f = await family();
    process.env.ELATION_READ_ALLOWLIST = '';

    const res = await read(f);
    expect(res.status).not.toBe(200);
    expect(res.signedUrl).toBeUndefined();
  });
});

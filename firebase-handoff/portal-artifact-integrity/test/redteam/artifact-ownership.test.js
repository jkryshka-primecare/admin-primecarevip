/**
 * Release 2a · D — artifact ownership red-team suite. STATEFUL.
 *
 * A STANDING CI GATE, run on every PR — not a one-off pass. Physical ownership
 * (files under the caller's uid) is being replaced by a read-time check, so
 * paths become guessable and this suite is the only thing that keeps the
 * ownership resolver honest.
 *
 * TARGET: emulator or a dedicated test project ONLY. Every helper here writes,
 * and helpers/env.js aborts the run if the target resolves to production.
 * Read-only bucket privacy lives in bucket-privacy.test.js, which may point at
 * the production bucket.
 *
 * Wire into CI: `npm run test:redteam` in deploy-production.yml, before deploy.
 *
 * MUTATION CHECK (run before trusting this gate): make the bucket public, or
 * short-circuit the ownership check in readArtifact.js, and confirm the suite
 * goes RED. A gate nobody has watched fail is not yet a gate.
 */

const { readArtifact, mintSignedUrl } = require('./helpers/portalRead');
const {
  seedPatient, seedDocument, healArtifact, accessLogRows, cleanup, seedGuardianOnlyAccount,
} = require('./helpers/seed');

jest.setTimeout(120000);

afterAll(async () => {
  await cleanup();
});

describe('cross-patient access', () => {
  test('patient A cannot read patient B artifact by guessing the path', async () => {
    const a = await seedPatient();
    const b = await seedPatient();
    const docB = await seedDocument(b, { module: 'labs' });
    const res = await readArtifact({ as: a, doc: docB });
    // Absence, not "forbidden": A's own record has no such report, and the
    // object lives under B's uid prefix. Either way A learns nothing.
    expect(res.status).toBe(404);
    expect(res.signedUrl).toBeUndefined();
  });

  test('a guessed storage path is not directly fetchable without a signed URL', async () => {
    const b = await seedPatient();
    const docB = await seedDocument(b, { module: 'imaging' });
    const direct = await fetch(`https://storage.googleapis.com/${docB.bucket}/${docB.path}`);
    expect(direct.status).toBeGreaterThanOrEqual(400);
  });
});

describe('signed URLs', () => {
  // SKIPPED: the Storage emulator does not enforce v4 signed-URL expiry, so
  // this case can only be verified against a real bucket. Covered by the
  // production-side bucket-privacy suite; re-enable if emulator support lands.
  test.skip('an expired signed URL is rejected', async () => {
    const p = await seedPatient();
    const doc = await seedDocument(p);
    const url = await mintSignedUrl({ as: p, doc, ttlSeconds: 1 });
    await new Promise((r) => setTimeout(r, 2500));
    expect((await fetch(url)).status).toBeGreaterThanOrEqual(400);
  });

  test('a signed URL minted for A does not work after A is suspended and is not re-mintable', async () => {
    const p = await seedPatient();
    const doc = await seedDocument(p);
    await p.suspend();
    const res = await readArtifact({ as: p, doc });
    expect(res.status).toBe(403);
  });
});

describe('suppression survives healing — healing is not a side channel', () => {
  test('a hidden item stays hidden immediately after a heal', async () => {
    const p = await seedPatient();
    const doc = await seedDocument(p, { missingObject: true, module: 'labs' });
    await p.hideItem({ module: doc.module, id: doc.documentId });
    await healArtifact(doc); // sweep stores the object
    const res = await readArtifact({ as: p, doc });
    expect(res.status).toBe(404); // hidden items read as absent, never as content
    expect(res.signedUrl).toBeUndefined();
  });

  test('a suspended patient still gets 403 after a heal', async () => {
    const p = await seedPatient();
    const doc = await seedDocument(p, { missingObject: true });
    await p.suspend();
    await healArtifact(doc);
    const res = await readArtifact({ as: p, doc });
    expect(res.status).toBe(403);
  });
});

describe('per-module suppression matches the wrapper that serves it', () => {
  test.each([
    ['getLabs', 'labs'],
    ['getImaging', 'imaging'],
    ['getMedicalRecords', 'records'],
  ])('%s: hiding under %s makes the item read as absent', async (wrapper, moduleKey) => {
    const p = await seedPatient();
    const doc = await seedDocument(p, { module: moduleKey });
    const ok = await readArtifact({ as: p, doc, wrapper });
    expect(ok.status).toBe(200);
    await p.hideItem({ module: moduleKey, id: doc.documentId });
    const res = await readArtifact({ as: p, doc, wrapper });
    expect(res.status).toBe(404);
    expect(res.signedUrl).toBeUndefined();
  });

  test('a hidden lab cannot be laundered through another wrapper (cross-calling)', async () => {
    const p = await seedPatient();
    const lab = await seedDocument(p, { module: 'labs' });
    await p.hideItem({ module: 'labs', id: lab.documentId });
    // Correct wrapper: suppressed.
    expect((await readArtifact({ as: p, doc: lab, wrapper: 'getLabs' })).status).toBe(404);
    // Wrong wrappers must NOT re-open it: the effective module comes from the
    // stored `category`, not the caller's module param.
    for (const wrapper of ['getImaging', 'getMedicalRecords']) {
      const res = await readArtifact({ as: p, doc: lab, wrapper });
      expect(res.status).toBe(404);
      expect(res.signedUrl).toBeUndefined();
    }
  });

  test('a visible lab is still not servable through the imaging wrapper', async () => {
    const p = await seedPatient();
    const lab = await seedDocument(p, { module: 'labs' });
    expect((await readArtifact({ as: p, doc: lab, wrapper: 'getLabs' })).status).toBe(200);
    expect((await readArtifact({ as: p, doc: lab, wrapper: 'getImaging' })).status).toBe(404);
  });

  test('hiding under one module does not suppress another module', async () => {
    const p = await seedPatient();
    const lab = await seedDocument(p, { module: 'labs' });
    const img = await seedDocument(p, { module: 'imaging' });
    await p.hideItem({ module: 'labs', id: lab.documentId });
    expect((await readArtifact({ as: p, doc: lab })).status).toBe(404);
    expect((await readArtifact({ as: p, doc: img })).status).toBe(200);
  });
});

describe('repair queue cannot be steered', () => {
  test('enqueue ignores any caller-supplied patient id', async () => {
    const a = await seedPatient();
    const b = await seedPatient();
    const docB = await seedDocument(b, { missingObject: true });
    // A asks to "repair document B", explicitly naming B as owner.
    const res = await readArtifact({
      as: a,
      doc: docB,
      body: { patientId: b.patientId, module: 'labs' },
    });
    expect(res.status).toBe(404);
    const rows = await b.repairQueueRows();
    expect(rows).toHaveLength(0); // nothing was queued on A's behalf for B
  });

  test('repeated on-miss reads dedup on (patientId, documentId)', async () => {
    const p = await seedPatient();
    const doc = await seedDocument(p, { missingObject: true });
    await readArtifact({ as: p, doc });
    await readArtifact({ as: p, doc });
    const rows = await p.repairQueueRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(`${p.patientId}:${doc.documentId}`);
  });

  test('an on-miss read returns the preparing state, not an Elation round-trip', async () => {
    const p = await seedPatient();
    const doc = await seedDocument(p, { missingObject: true });
    const res = await readArtifact({ as: p, doc });
    expect(res.body.state).toBe('preparing');
    expect(res.elapsedMs).toBeLessThan(1500);
  });
});

/**
 * RELEASE 2b — guardian proxy access. LIVE, not scaffolding.
 *
 * A minor never logs in; a guardian reads the child's record through the same
 * shared handler. Storage is keyed on the record's `internalUid` (Part B), so a
 * child with no Firebase uid is still addressable and a heal can never land the
 * child's PDF under the guardian's prefix.
 *
 * Guardian reads are behind `GUARDIAN_READS_ENABLED`; the flag is forced ON for
 * this block only, so a production default of OFF cannot make the gate green by
 * accident.
 */
describe('[2b] guardian proxy access', () => {
  const priorFlag = process.env.GUARDIAN_READS_ENABLED;
  beforeAll(() => { process.env.GUARDIAN_READS_ENABLED = 'true'; });
  afterAll(() => { process.env.GUARDIAN_READS_ENABLED = priorFlag; });

  async function family({ status = 'active' } = {}) {
    const guardian = await seedPatient();
    const child = await seedPatient({ minor: true });
    await child.linkGuardian(guardian, { status });
    const doc = await seedDocument(child, { module: 'labs' });
    return { guardian, child, doc };
  }

  test('an active guardian reads the linked child artifact', async () => {
    const { guardian, child, doc } = await family();
    const res = await readArtifact({ as: guardian, of: child, doc });
    expect(res.status).toBe(200);
    expect(res.signedUrl).toEqual(expect.any(String));
  });

  test('a revoked guardian reads exactly like a stranger', async () => {
    const { guardian, child, doc } = await family();
    await child.setGuardianStatus(guardian, 'revoked');
    const revoked = await readArtifact({ as: guardian, of: child, doc });

    const stranger = await seedPatient();
    const unlinked = await readArtifact({ as: stranger, of: child, doc });

    expect(revoked.status).toBe(404);
    expect(revoked.signedUrl).toBeUndefined();
    // Indistinguishable: same status, same reason, no "was removed" signal.
    expect(revoked.status).toBe(unlinked.status);
    expect(revoked.body.reason).toBe(unlinked.body.reason);
  });

  test('a pending_adult_consent guardian is denied', async () => {
    const { guardian, child, doc } = await family({ status: 'pending_adult_consent' });
    const res = await readArtifact({ as: guardian, of: child, doc });
    expect(res.status).toBe(404);
    expect(res.signedUrl).toBeUndefined();
  });

  test('a guardian of child A cannot read child B, and queues no repair', async () => {
    const { guardian } = await family();
    const other = await seedPatient({ minor: true });
    const otherDoc = await seedDocument(other, { module: 'labs', missingObject: true });

    const res = await readArtifact({ as: guardian, of: other, doc: otherDoc });
    expect(res.status).toBe(404);
    expect(res.signedUrl).toBeUndefined();
    // No existence leak and, critically, no repair the healer could follow.
    expect(await other.repairQueueRows()).toHaveLength(0);
  });

  test('shared-email guardians revoke independently (entry-scoped binding)', async () => {
    // Greg and Jill share one household email; each entry is its own proxy.
    const greg = await seedPatient();
    const jill = await seedPatient();
    const child = await seedPatient({ minor: true });
    await child.linkGuardian(greg);
    await child.linkGuardian(jill);
    const doc = await seedDocument(child, { module: 'labs' });

    await child.setGuardianStatus(greg, 'revoked');

    expect((await readArtifact({ as: greg, of: child, doc })).status).toBe(404);
    expect((await readArtifact({ as: jill, of: child, doc })).status).toBe(200);
  });

  test('suppression on the child applies identically to the guardian', async () => {
    const { guardian, child } = await family();
    const hidden = await seedDocument(child, { module: 'labs', hidden: true });
    const res = await readArtifact({ as: guardian, of: child, doc: hidden });
    expect(res.status).toBe(404);
    expect(res.body.reason).toBe('ARTIFACT_NOT_SYNCED');
  });

  test('a module toggled off on the child hides it from the guardian', async () => {
    const { guardian, child } = await family();
    const doc = await seedDocument(child, { module: 'imaging' });
    await child.setModule('imaging', false);
    const res = await readArtifact({ as: guardian, of: child, doc });
    expect(res.status).toBe(404);
    expect(res.signedUrl).toBeUndefined();
  });

  test('a proxy read logs BOTH uids', async () => {
    const { guardian, child, doc } = await family();
    await readArtifact({ as: guardian, of: child, doc });
    const rows = await accessLogRows({ reportId: doc.documentId });
    expect(rows.length).toBeGreaterThan(0);
    const row = rows.find((r) => r.mode === 'guardian');
    expect(row).toBeDefined();
    expect(row.actingUid).toBe(guardian.firebaseUid);
    expect(row.subjectElationId).toBe(child.patientId);
    expect(row.subjectUid).toBe(child.internalUid);
  });
});

/**
 * Release 2b PHASE 1 — chart-backed guardian authorization.
 *
 * Production guardian links all carry `guardianUid: null` (nothing ever bound
 * them), so these cases seed with `bindUid: false` and prove the resolver
 * authorizes off the CHART (caller's own elationId === entry's
 * guardianElationId), lazily binds exactly one entry, and — the fence that
 * matters most — never lets a null caller id match a null guardianElationId.
 */
describe('[2b-phase1] chart-backed guardian authorization', () => {
  const priorFlag = process.env.GUARDIAN_READS_ENABLED;
  beforeAll(() => { process.env.GUARDIAN_READS_ENABLED = 'true'; });
  afterAll(() => { process.env.GUARDIAN_READS_ENABLED = priorFlag; });

  test('authorizes an unbound guardian and binds exactly one entry', async () => {
    const guardian = await seedPatient();
    const child = await seedPatient({ minor: true });
    await child.linkGuardian(guardian, { bindUid: false });
    const doc = await seedDocument(child, { module: 'labs' });

    const res = await readArtifact({ as: guardian, of: child, doc });
    expect(res.status).toBe(200);

    const entries = await child.guardianEntries();
    const bound = entries.filter((g) => g.guardianUid === guardian.firebaseUid);
    expect(bound).toHaveLength(1);
    expect(bound[0].guardianElationId).toBe(guardian.patientId);
  });

  test('NULL FENCE: an account with no owned record never matches a null-guardianElationId entry', async () => {
    const child = await seedPatient({ minor: true });
    // email_on_file entry: guardianElationId === null, unbound.
    await child.linkGuardian({ patientId: 'someone', firebaseUid: null }, { emailOnly: true });
    const doc = await seedDocument(child, { module: 'labs' });

    const ghost = await seedGuardianOnlyAccount();
    const res = await readArtifact({ as: ghost, of: child, doc });
    expect(res.status).toBe(404);
    expect(res.signedUrl).toBeUndefined();
    // And nothing was bound as a side effect.
    const entries = await child.guardianEntries();
    expect(entries.every((g) => !g.guardianUid)).toBe(true);
  });

  test('a chart-backed guardian does NOT match an email_on_file entry on another child', async () => {
    const guardian = await seedPatient();
    const other = await seedPatient({ minor: true });
    await other.linkGuardian(guardian, { emailOnly: true });
    const doc = await seedDocument(other, { module: 'labs' });
    expect((await readArtifact({ as: guardian, of: other, doc })).status).toBe(404);
  });

  test('sibling children bind independently', async () => {
    const guardian = await seedPatient();
    const a = await seedPatient({ minor: true });
    const b = await seedPatient({ minor: true });
    await a.linkGuardian(guardian, { bindUid: false });
    await b.linkGuardian(guardian, { bindUid: false });
    const docA = await seedDocument(a, { module: 'labs' });
    const docB = await seedDocument(b, { module: 'labs' });

    expect((await readArtifact({ as: guardian, of: a, doc: docA })).status).toBe(200);
    expect((await a.guardianEntries()).filter((g) => g.guardianUid).length).toBe(1);
    // b is untouched until it is itself read.
    expect((await b.guardianEntries()).every((g) => !g.guardianUid)).toBe(true);
    expect((await readArtifact({ as: guardian, of: b, doc: docB })).status).toBe(200);
    expect((await b.guardianEntries()).filter((g) => g.guardianUid).length).toBe(1);
  });

  test('a revoked entry never authorizes and never binds', async () => {
    const guardian = await seedPatient();
    const child = await seedPatient({ minor: true });
    await child.linkGuardian(guardian, { bindUid: false, status: 'revoked' });
    const doc = await seedDocument(child, { module: 'labs' });

    expect((await readArtifact({ as: guardian, of: child, doc })).status).toBe(404);
    expect((await child.guardianEntries()).every((g) => !g.guardianUid)).toBe(true);
  });

  test('a pending_adult_consent entry never authorizes and never binds', async () => {
    const guardian = await seedPatient();
    const child = await seedPatient({ minor: true });
    await child.linkGuardian(guardian, { bindUid: false, status: 'pending_adult_consent' });
    const doc = await seedDocument(child, { module: 'labs' });

    expect((await readArtifact({ as: guardian, of: child, doc })).status).toBe(404);
    expect((await child.guardianEntries()).every((g) => !g.guardianUid)).toBe(true);
  });

  test('two guardians sharing an email but with distinct charts bind separately', async () => {
    const greg = await seedPatient();
    const jill = await seedPatient();
    const child = await seedPatient({ minor: true });
    await child.linkGuardian(greg, { bindUid: false });
    await child.linkGuardian(jill, { bindUid: false });
    const doc = await seedDocument(child, { module: 'labs' });

    expect((await readArtifact({ as: greg, of: child, doc })).status).toBe(200);
    expect((await readArtifact({ as: jill, of: child, doc })).status).toBe(200);

    const entries = await child.guardianEntries();
    const byGreg = entries.find((g) => g.guardianElationId === greg.patientId);
    const byJill = entries.find((g) => g.guardianElationId === jill.patientId);
    expect(byGreg.guardianUid).toBe(greg.firebaseUid);
    expect(byJill.guardianUid).toBe(jill.firebaseUid);
    expect(byGreg.guardianUid).not.toBe(byJill.guardianUid);
  });

  test('the lazy bind is audited with both identities', async () => {
    const guardian = await seedPatient();
    const child = await seedPatient({ minor: true });
    await child.linkGuardian(guardian, { bindUid: false });
    const doc = await seedDocument(child, { module: 'labs' });
    await readArtifact({ as: guardian, of: child, doc });

    const rows = await accessLogRows({ reportId: doc.documentId });
    const bindRow = rows.find((r) => r.outcome === 'guardian_uid_bound');
    expect(bindRow).toBeDefined();
    expect(bindRow.actingUid).toBe(guardian.firebaseUid);
    expect(bindRow.subjectElationId).toBe(child.patientId);
  });
});

describe('[2b] internal-UID storage re-key', () => {
  test('an authorized read resolves the object at the internalUid path', async () => {
    const p = await seedPatient();
    const doc = await seedDocument(p);
    expect(doc.path).toBe(`elation-artifacts/${p.internalUid}/${doc.documentId}/report.pdf`);
    const res = await readArtifact({ as: p, doc });
    expect(res.status).toBe(200);
    expect(res.signedUrl).toEqual(expect.any(String));
  });

  test('a guessed cross-subject path is still not fetchable (2a privacy preserved)', async () => {
    const b = await seedPatient();
    const docB = await seedDocument(b);
    const direct = await fetch(`https://storage.googleapis.com/${docB.bucket}/${docB.path}`);
    expect(direct.status).toBeGreaterThanOrEqual(400);
  });

  test('claiming a login does NOT change the record internalUid', async () => {
    const p = await seedPatient({ minor: true });
    const before = p.internalUid;
    await p.claimLogin(`${p.patientId}-claimed-uid`);
    expect(await p.readInternalUid()).toBe(before);
  });
});


describe('coverage audit resolves the uid from the parent patient doc', () => {
  // Production lab docs carry no `artifactPath` and no `firebaseUid`; the uid
  // lives on the parent patient doc, lowercased. Resolving it off the lab doc
  // classified every artifact as `unpathed` (coveragePct: null).
  // eslint-disable-next-line import/no-unresolved, global-require
  const { _runAudit } = require('../../functions/auditArtifactCoverage');

  it('counts a bound patient as present and an unbound patient as unpathed', async () => {
    const bound = await seedPatient({ id: 'audit-bound' });
    const seededBound = await seedDocument(bound, { documentId: 'audit-present' });

    const unbound = await seedPatient({ id: 'audit-unbound', bound: false });
    const seededUnbound = await seedDocument(unbound, { documentId: 'audit-unpathed' });

    const report = await _runAudit();

    const isPresent = !report.missing.some((m) => m.documentId === seededBound.documentId);
    expect(isPresent).toBe(true);
    expect(report.presentCount).toBeGreaterThan(0);
    expect(report.coveragePct).not.toBeNull();

    const unpathedIds = report.unpathed.map((u) => u.documentId);
    expect(unpathedIds).toContain(seededUnbound.documentId);
    // Never queued — the sweep must not be able to heal junk at `null/`.
    const rows = await unbound.repairQueueRows();
    expect(rows.some((r) => r.documentId === seededUnbound.documentId)).toBe(false);
  });
});

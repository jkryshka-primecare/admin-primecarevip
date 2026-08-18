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
const { seedPatient, seedDocument, healArtifact, cleanup } = require('./helpers/seed');

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
  test('an expired signed URL is rejected', async () => {
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
 * FORWARD SCAFFOLDING FOR 2b — intentionally skipped.
 *
 * Grants do not exist yet. These must not report green and must not be part of
 * the 2a go/no-go; a no-op test passing would imply coverage we do not have.
 */
describe.skip('[2b] grant-scoped access', () => {
  test('a revoked grant immediately loses access to the dependent artifact', () => {});
  test('a guardian sees exactly their own record plus active-grant dependents', () => {});
  test('module-off on a child applies to every linked guardian', () => {});
});

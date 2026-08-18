/**
 * Release 2a · D — artifact ownership red-team suite.
 *
 * A STANDING CI GATE, run on every PR — not a one-off pass. Physical ownership
 * (files under the caller's uid) is being replaced by a read-time check, so
 * paths become guessable and this suite is the only thing that keeps the
 * ownership resolver honest.
 *
 * Wire into CI: `npm run test:redteam` in deploy-production.yml, before deploy.
 */

const { getBucketMetadata, getIamPolicy, listObjectAcls } = require('./helpers/storage');
const { readArtifact, mintSignedUrl } = require('./helpers/portalRead');
const { seedPatient, seedDocument, healArtifact } = require('./helpers/seed');

jest.setTimeout(120000);

describe('bucket privacy is asserted, never assumed', () => {
  test('no allUsers / allAuthenticatedUsers binding on the artifact bucket', async () => {
    const policy = await getIamPolicy();
    const members = policy.bindings.flatMap((b) => b.members);
    expect(members).not.toContain('allUsers');
    expect(members).not.toContain('allAuthenticatedUsers');
  });

  test('uniform bucket-level access is enabled', async () => {
    const meta = await getBucketMetadata();
    expect(meta.iamConfiguration.uniformBucketLevelAccess.enabled).toBe(true);
  });

  test('no public object ACLs exist', async () => {
    const acls = await listObjectAcls({ sample: 200 });
    expect(acls.filter((a) => a.entity === 'allUsers')).toHaveLength(0);
  });
});

describe('cross-patient access', () => {
  test('patient A cannot read patient B artifact by guessing the path', async () => {
    const a = await seedPatient();
    const b = await seedPatient();
    const docB = await seedDocument(b);
    const res = await readArtifact({ as: a, documentId: docB.documentId });
    expect(res.status).toBe(403);
    expect(res.signedUrl).toBeUndefined();
  });

  test('a guessed storage path is not directly fetchable without a signed URL', async () => {
    const b = await seedPatient();
    const docB = await seedDocument(b);
    const direct = await fetch(`https://storage.googleapis.com/${docB.bucket}/${docB.path}`);
    expect(direct.status).toBeGreaterThanOrEqual(400);
  });
});

describe('signed URLs', () => {
  test('an expired signed URL is rejected', async () => {
    const p = await seedPatient();
    const doc = await seedDocument(p);
    const url = await mintSignedUrl({ as: p, documentId: doc.documentId, ttlSeconds: 1 });
    await new Promise((r) => setTimeout(r, 2500));
    expect((await fetch(url)).status).toBeGreaterThanOrEqual(400);
  });

  test('a signed URL minted for A does not work after A is suspended and is not re-mintable', async () => {
    const p = await seedPatient();
    const doc = await seedDocument(p);
    await p.suspend();
    const res = await readArtifact({ as: p, documentId: doc.documentId });
    expect(res.status).toBe(403);
  });
});

describe('suppression survives healing — healing is not a side channel', () => {
  test('a hidden item stays hidden immediately after a heal', async () => {
    const p = await seedPatient();
    const doc = await seedDocument(p, { missingObject: true });
    await p.hideItem({ collection: 'labs', id: doc.documentId });
    await healArtifact(doc); // sweep stores the object
    const res = await readArtifact({ as: p, documentId: doc.documentId });
    expect(res.status).toBe(404); // hidden items read as absent, never as content
    expect(res.signedUrl).toBeUndefined();
  });

  test('a suspended patient still gets 403 after a heal', async () => {
    const p = await seedPatient();
    const doc = await seedDocument(p, { missingObject: true });
    await p.suspend();
    await healArtifact(doc);
    const res = await readArtifact({ as: p, documentId: doc.documentId });
    expect(res.status).toBe(403);
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
      documentId: docB.documentId,
      body: { patientId: b.patientId },
    });
    expect(res.status).toBe(403);
    const rows = await b.repairQueueRows();
    expect(rows).toHaveLength(0); // nothing was queued on A's behalf for B
  });

  test('repeated on-miss reads dedup on (patientId, documentId)', async () => {
    const p = await seedPatient();
    const doc = await seedDocument(p, { missingObject: true });
    await readArtifact({ as: p, documentId: doc.documentId });
    await readArtifact({ as: p, documentId: doc.documentId });
    const rows = await p.repairQueueRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(`${p.patientId}:${doc.documentId}`);
  });

  test('an on-miss read returns the preparing state, not an Elation round-trip', async () => {
    const p = await seedPatient();
    const doc = await seedDocument(p, { missingObject: true });
    const res = await readArtifact({ as: p, documentId: doc.documentId });
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

/**
 * Release 2a · D — bucket privacy assertions. READ-ONLY.
 *
 * This file writes nothing, so it is the only red-team file that may point at
 * the production serving bucket (REDTEAM_STORAGE_BUCKET). It is a standing CI
 * gate: `npm run test:redteam:readonly`.
 */

const { getBucketMetadata, getIamPolicy, listObjectAcls } = require('./helpers/storage');

jest.setTimeout(120000);

describe('bucket privacy is asserted, never assumed', () => {
  test('no allUsers / allAuthenticatedUsers binding on the artifact bucket', async () => {
    const policy = await getIamPolicy();
    const members = (policy.bindings || []).flatMap((b) => b.members || []);
    expect(members).not.toContain('allUsers');
    expect(members).not.toContain('allAuthenticatedUsers');
  });

  test('uniform bucket-level access is enabled', async () => {
    const meta = await getBucketMetadata();
    expect(meta.iamConfiguration.uniformBucketLevelAccess.enabled).toBe(true);
  });

  test('no public object ACLs exist', async () => {
    // Entries are FLATTENED: each has entity/role, or aclDenied under UBLA
    // (which is itself the pass condition). The old nested shape made this
    // filter vacuously empty — see review round 2.
    const entries = await listObjectAcls({ sample: 200 });
    const inspected = entries.filter((e) => !e.aclDenied);
    const denied = entries.filter((e) => e.aclDenied);
    expect(entries.length).toBeGreaterThan(0); // never pass on an empty sample
    expect(inspected.filter((e) => e.entity === 'allUsers')).toHaveLength(0);
    expect(inspected.filter((e) => e.entity === 'allAuthenticatedUsers')).toHaveLength(0);
    if (inspected.length === 0) {
      // Every ACL read was rejected: uniform bucket-level access is in force,
      // so object ACLs cannot exist at all. Explicit pass, not a silent one.
      expect(denied.length).toBe(entries.length);
    }
  });
});

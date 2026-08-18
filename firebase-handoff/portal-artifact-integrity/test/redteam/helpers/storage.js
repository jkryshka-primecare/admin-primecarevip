/**
 * Red-team helpers — Storage. REAL bucket only, never mocked.
 *
 * A green suite over stubbed helpers is theater: these functions hit the actual
 * bucket named by REDTEAM_STORAGE_BUCKET, so bucket privacy is asserted rather
 * than assumed. If credentials or the bucket name are absent the helpers throw —
 * the suite fails loudly instead of passing vacuously.
 *
 * Read-only inspection (metadata / IAM / ACLs) may point at the production
 * serving bucket. Object writes go through `assertStatefulTargetAllowed`, which
 * refuses production. See helpers/env.js.
 */

const admin = require('firebase-admin');
const { assertReadOnlyTargetConfigured, assertStatefulTargetAllowed, resolveProjectId } = require('./env');

function initOnce() {
  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: resolveProjectId() || undefined,
      storageBucket: process.env.REDTEAM_STORAGE_BUCKET,
    });
  }
  return admin;
}

/** Read-only bucket handle (inspection only). */
function bucket() {
  assertReadOnlyTargetConfigured();
  const b = initOnce().storage().bucket();
  if (!b || !b.name) throw new Error('red-team: no real Storage bucket resolved — refusing to run');
  return b;
}

/** Write-capable bucket handle. Refuses production targets. */
function writableBucket() {
  assertStatefulTargetAllowed();
  return bucket();
}

/** Raw bucket metadata, including uniformBucketLevelAccess. */
async function getBucketMetadata() {
  const [meta] = await bucket().getMetadata();
  return meta;
}

/** Real IAM policy on the bucket (checked for allUsers / allAuthenticatedUsers). */
async function getIamPolicy() {
  const [policy] = await bucket().iam.getPolicy({ requestedPolicyVersion: 3 });
  return policy;
}

/**
 * FLATTENED object ACL entries across a sample of objects.
 *
 * Review round 2: the old shape (`{ name, acl }`) made the test's
 * `filter(a => a.entity === 'allUsers')` always empty — the assertion passed
 * even if a public ACL existed. Each returned element is now a single ACL
 * entry: `{ name, entity, role }`.
 *
 * Under uniform bucket-level access GCS rejects `acl.get()` entirely; that is
 * the pass condition, surfaced as `{ name, aclDenied: true }` entries which
 * carry no `entity`, so they can never look like a public grant.
 */
async function listObjectAcls({ prefix = '', sample = 100 } = {}) {
  const [files] = await bucket().getFiles({ prefix, maxResults: sample });
  const out = [];
  for (const f of files) {
    try {
      const [acl] = await f.acl.get();
      const entries = Array.isArray(acl) ? acl : [acl];
      for (const e of entries) {
        if (!e) continue;
        out.push({ name: f.name, entity: e.entity, role: e.role });
      }
    } catch (err) {
      out.push({ name: f.name, aclDenied: true, reason: String(err && err.message) });
    }
  }
  return out;
}

module.exports = { getBucketMetadata, getIamPolicy, listObjectAcls, bucket, writableBucket, initOnce };

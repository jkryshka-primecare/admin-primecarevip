/**
 * Red-team helpers — Storage. REAL bucket only, never mocked.
 *
 * A green suite over stubbed helpers is theater: these functions must hit the
 * actual bucket the portal serves from, so bucket privacy is asserted rather
 * than assumed. If credentials are absent the helpers throw — the suite fails
 * loudly instead of passing vacuously.
 */

const admin = require('firebase-admin');

function bucket() {
  if (!admin.apps.length) {
    admin.initializeApp({ storageBucket: process.env.REDTEAM_STORAGE_BUCKET });
  }
  const b = admin.storage().bucket();
  if (!b || !b.name) throw new Error('red-team: no real Storage bucket resolved — refusing to run');
  return b;
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
 * Object-level ACLs for a prefix. Under uniform bucket-level access this call
 * is rejected by GCS, which is itself the pass condition — the helper reports
 * that explicitly rather than swallowing it.
 */
async function listObjectAcls(prefix) {
  const [files] = await bucket().getFiles({ prefix, maxResults: 25 });
  const out = [];
  for (const f of files) {
    try {
      const [acl] = await f.acl.get();
      out.push({ name: f.name, acl });
    } catch (err) {
      out.push({ name: f.name, aclDenied: true, reason: String(err && err.message) });
    }
  }
  return out;
}

module.exports = { getBucketMetadata, getIamPolicy, listObjectAcls, bucket };

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
const {
  assertReadOnlyTargetConfigured,
  assertStatefulTargetAllowed,
  resolveProjectId,
  PROD_PROJECT_IDS,
} = require('./env');
const { artifactBucketName } = require('../../../functions/core/config/artifactBucket');



/**
 * v4 signing needs a private key. Under the emulator the stateful job has NO
 * credentials by design (no production SA on the PR trigger), so
 * `file.getSignedUrl()` throws "Could not load the default credentials" and the
 * shared read path maps it to 500 SIGN_ERROR — every expected-200 serve case
 * fails while suppression/preparing cases (which never sign) pass.
 *
 * GOOG4-RSA signing is entirely local: any RSA key produces a valid signature,
 * and the Storage emulator does not verify it. So the harness mints a throwaway
 * key per run and signs with that. This keeps the REAL serve path under test —
 * no assertion is weakened — and the key never leaves the process.
 * Only ever used when a Storage emulator is present.
 */
function emulatorSigningCredential() {
  if (!process.env.STORAGE_EMULATOR_HOST) return undefined;
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return undefined;
  // eslint-disable-next-line global-require
  const { generateKeyPairSync } = require('crypto');
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return admin.credential.cert({
    projectId: resolveProjectId() || 'demo-redteam',
    clientEmail: `redteam@${resolveProjectId() || 'demo-redteam'}.iam.gserviceaccount.com`,
    privateKey,
  });
}

function initOnce() {
  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: resolveProjectId() || undefined,
      storageBucket: process.env.REDTEAM_STORAGE_BUCKET,
      credential: emulatorSigningCredential(),
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

/**
 * Write-capable bucket handle. Refuses production targets.
 *
 * CRITICAL: the seed MUST write to the same bucket the code under test reads.
 * Resolving the app default here (REDTEAM_STORAGE_BUCKET) while read/audit/sweep
 * resolve `artifactBucketName()` made writer and readers disagree under the
 * emulator — signed reads 500'd or `exists()` reported false. One resolver only.
 */
function writableBucket() {
  assertStatefulTargetAllowed();
  assertReadOnlyTargetConfigured();
  const name = artifactBucketName();
  // The resolved name may be the production artifact bucket (that is the point:
  // one resolver). Writes are only ever safe when they are routed to the Storage
  // emulator, so require it explicitly whenever the name looks production.
  const emulated = Boolean(process.env.STORAGE_EMULATOR_HOST);
  if (!emulated && PROD_PROJECT_IDS.some((p) => name.startsWith(p))) {
    throw new Error(`red-team: refusing to write objects to production bucket "${name}" without a Storage emulator`);
  }
  const b = initOnce().storage().bucket(name);
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

/**
 * Red-team helpers — target guard.
 *
 * Review round 2, item 3: the seeding tests MUST NOT run against production.
 * Two distinct targets exist and they are never the same process:
 *
 *   READ-ONLY  privacy assertions (IAM policy, bucket metadata, object ACLs)
 *              may point at the real production bucket — they only read.
 *   STATEFUL   seed / read / heal cases must point at the Firestore emulator
 *              or a dedicated test project. Anything else aborts the run.
 *
 * Nothing is inferred. If the environment is not explicitly declared, the
 * helpers throw and the suite fails loudly rather than writing somewhere real.
 */

const PROD_PROJECT_IDS = ['prive-care-vip'];

/** Project id the admin SDK will actually use. */
function resolveProjectId() {
  return (
    process.env.REDTEAM_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    null
  );
}

/**
 * `firebase emulators:exec` exports FIREBASE_STORAGE_EMULATOR_HOST (host:port),
 * while the Admin SDK / GCS client reads STORAGE_EMULATOR_HOST (a full URL).
 * Reconcile the two so the harness works under emulators:exec with no extra
 * wiring in CI. Never invents an emulator that is not running.
 */
function normalizeEmulatorEnv() {
  const fb = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
  if (fb && !process.env.STORAGE_EMULATOR_HOST) {
    process.env.STORAGE_EMULATOR_HOST = /^https?:\/\//.test(fb) ? fb : `http://${fb}`;
  }
  return process.env.STORAGE_EMULATOR_HOST || null;
}

normalizeEmulatorEnv();

function usingEmulator() {
  return Boolean(process.env.FIRESTORE_EMULATOR_HOST);
}

/**
 * Assert this process may create/modify state. Call at the top of every
 * write-capable helper — seeding, healing, storage writes.
 */
function assertStatefulTargetAllowed() {
  if (!process.env.REDTEAM_ALLOW_WRITES) {
    throw new Error('red-team: REDTEAM_ALLOW_WRITES not set — refusing to write');
  }
  const projectId = resolveProjectId();
  const bucket = process.env.REDTEAM_STORAGE_BUCKET || '';

  // The Firestore emulator does NOT emulate Storage. Without an explicit
  // Storage emulator, object writes land in real GCS — so the emulator branch
  // enforces the same production-bucket guard and demands STORAGE_EMULATOR_HOST.
  if (usingEmulator()) {
    if (!normalizeEmulatorEnv()) {
      throw new Error(
        'red-team: FIRESTORE_EMULATOR_HOST is set but neither STORAGE_EMULATOR_HOST nor FIREBASE_STORAGE_EMULATOR_HOST is — object writes would hit real GCS',
      );
    }
    if (PROD_PROJECT_IDS.some((p) => bucket.startsWith(p))) {
      throw new Error(`red-team: refusing to write objects to production bucket "${bucket}"`);
    }
    if (projectId && PROD_PROJECT_IDS.includes(projectId)) {
      throw new Error(`red-team: refusing to seed production project "${projectId}"`);
    }
    return { target: 'emulator', projectId };
  }


  if (process.env.REDTEAM_TARGET !== 'test-project') {
    throw new Error(
      'red-team: stateful cases require FIRESTORE_EMULATOR_HOST or REDTEAM_TARGET=test-project',
    );
  }
  if (!projectId) {
    throw new Error('red-team: REDTEAM_PROJECT_ID must name the dedicated test project');
  }
  if (PROD_PROJECT_IDS.includes(projectId)) {
    throw new Error(`red-team: refusing to seed production project "${projectId}"`);
  }
  if (PROD_PROJECT_IDS.some((p) => bucket.startsWith(p))) {
    throw new Error(`red-team: refusing to write objects to production bucket "${bucket}"`);
  }

  return { target: 'test-project', projectId };
}

/** Assert this process may perform the read-only privacy assertions. */
function assertReadOnlyTargetConfigured() {
  if (!process.env.REDTEAM_STORAGE_BUCKET) {
    throw new Error('red-team: REDTEAM_STORAGE_BUCKET must name the bucket to inspect');
  }
  return { bucket: process.env.REDTEAM_STORAGE_BUCKET };
}

module.exports = {
  normalizeEmulatorEnv,
  assertStatefulTargetAllowed,
  assertReadOnlyTargetConfigured,
  resolveProjectId,
  usingEmulator,
  PROD_PROJECT_IDS,
};

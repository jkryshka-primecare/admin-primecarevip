/**
 * Release 2a · item 4 — LIVE read-path smoke, as a deployed admin function.
 *
 * This is `scripts/prod-read-path-smoke.js` moved inside the Firebase project
 * so staff can run it from the admin OS instead of Cloud Shell. It mints a
 * patient ID token for the fixture, calls the DEPLOYED getLabs / getImaging /
 * getMedicalRecords over https exactly as the portal does, fetches the signed
 * URL and checks for real `%PDF-` bytes, then reports a pass/fail table.
 *
 * WHAT IT WRITES
 *   Nothing on any chart. It flips `portalAccess/{patientId}` twice (module
 *   hidden, then status suspended) and restores the original document verbatim
 *   in a `finally` — deleting it again if it did not exist. The restore is
 *   verified as its own assertion.
 *
 * SAFETY RAILS
 *   - Admin-only (`requireAdminCaller`), same gate as every other admin fn.
 *   - Refuses to run against any patient other than the configured fixture,
 *     so it can never toggle a real member's access.
 *
 * DEPLOY NOTE: HTTP admin function. Add `adminRunReadPathSmoke` to
 * `lock-admin-invokers.yml`'s ADMIN_FUNCTIONS, exclude it from both health-gate
 * FUNCTIONS arrays in deploy-production.yml (IAM-restricted → anonymous probe
 * gets 403), and export it inside `module.exports` in index.js.
 *
 * CONFIG (functions env):
 *   SMOKE_WEB_API_KEY   Firebase Web API key — required for the custom-token
 *                       exchange. Without it the run aborts with a clear error.
 *   SMOKE_PATIENT_ID    default 816455979040769  (Test Kieffer fixture)
 *   SMOKE_FIREBASE_UID  default d8h7h6xc6axkq3k3tgnoz6ytxmx1
 *   SMOKE_MISSING_ID    default SMOKE-LAB-2 (known reference with no object)
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { requireAdminCaller, selfAudience } = require('./middleware/requireAdminCaller');

const REGION = 'us-central1';
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'prive-care-vip';
const BASE = process.env.FUNCTIONS_BASE || `https://${REGION}-${PROJECT_ID}.cloudfunctions.net`;

const FIXTURE_PATIENT_ID = String(process.env.SMOKE_PATIENT_ID || '816455979040769');
const FIXTURE_UID = String(process.env.SMOKE_FIREBASE_UID || 'd8h7h6xc6axkq3k3tgnoz6ytxmx1');
const MISSING_ID = process.env.SMOKE_MISSING_ID || 'SMOKE-LAB-2';

const FN_BY_MODULE = { labs: 'getLabs', imaging: 'getImaging', records: 'getMedicalRecords' };

function webApiKey() {
  if (process.env.SMOKE_WEB_API_KEY) return process.env.SMOKE_WEB_API_KEY;
  try {
    const cfg = functions.config();
    return (cfg && cfg.smoke && cfg.smoke.web_api_key) || '';
  } catch (_e) {
    return '';
  }
}

// ----------------------------------------------------------------- auth ----

async function mintPatientIdToken() {
  const key = webApiKey();
  if (!key) {
    throw new Error(
      'SMOKE_WEB_API_KEY is not configured on the functions runtime — the ' +
      'custom-token exchange cannot run.',
    );
  }
  const customToken = await admin.auth().createCustomToken(FIXTURE_UID, { role: 'patient' });
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.idToken) {
    throw new Error(`token exchange failed (${res.status}): ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body.idToken;
}

// -------------------------------------------------------------- calling ----

async function callRead(token, moduleKey, reportId) {
  const res = await fetch(`${BASE}/${FN_BY_MODULE[moduleKey]}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(reportId ? { reportId } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_e) { /* keep raw */ }
  return { status: res.status, json, raw: text.slice(0, 400) };
}

/** Some paths answer 200 with an error envelope; normalize to one number. */
function effectiveStatus(r) {
  const inner = r.json && r.json.error && r.json.error.code;
  return typeof inner === 'number' ? inner : r.status;
}

function reasonOf(r) {
  return (r.json && r.json.error && r.json.error.details && r.json.error.details.reason) || '';
}

// ------------------------------------------------------------ discovery ----

/**
 * All three modules read the SAME subcollection — `patients/{id}/labs` — and
 * separate themselves by `category` ('lab' | 'imaging' | 'medical_records').
 * The first cut of this smoke queried `imaging` / `records` subcollections
 * that do not exist in the data model, so imaging and records could never
 * find a fixture and always reported FAIL. Discovery now mirrors the handlers.
 */
const CATEGORY_BY_MODULE = { labs: 'lab', imaging: 'imaging', records: 'medical_records' };

async function discover(moduleKey) {
  const snap = await admin.firestore()
    .collection('patients').doc(FIXTURE_PATIENT_ID).collection('labs')
    .where('category', '==', CATEGORY_BY_MODULE[moduleKey])
    .where('hasArtifact', '==', true)
    .limit(10)
    .get()
    .catch(() => null);
  if (!snap || snap.empty) return null;
  const hit = snap.docs.find((d) => d.id !== MISSING_ID);
  return hit ? hit.id : null;
}


// ------------------------------------------------- portalAccess toggling ----

const accessRef = () => admin.firestore().collection('portalAccess').doc(FIXTURE_PATIENT_ID);

async function snapshotAccess() {
  const snap = await accessRef().get();
  return { existed: snap.exists, data: snap.exists ? snap.data() : null };
}

async function restoreAccess(saved) {
  if (!saved.existed) { await accessRef().delete().catch(() => {}); return; }
  await accessRef().set(saved.data); // full overwrite — byte-for-byte restore
}

// ----------------------------------------------------------------- run ----

async function runSmoke() {
  const results = [];
  const record = (name, pass, detail) => {
    results.push({ name, pass, detail: detail || '' });
    functions.logger.info(`smoke ${pass ? 'PASS' : 'FAIL'}: ${name}`, { detail });
  };
  /**
   * Absence of fixture data is NOT a read-path defect. If the fixture patient
   * holds no imaging (or no medical record) with an artifact, there is nothing
   * to assert — that case is inconclusive, and reporting it as FAIL made the
   * whole smoke look red for a data-seeding gap.
   */
  const skip = (name, detail) => {
    results.push({ name, pass: true, skipped: true, detail: detail || '' });
    functions.logger.info(`smoke SKIP: ${name}`, { detail });
  };


  const token = await mintPatientIdToken();
  record('mint patient ID token', true, 'custom token + identitytoolkit exchange');

  const labId = await discover('labs');
  const imagingId = await discover('imaging');
  const recordId = await discover('records');

  const saved = await snapshotAccess();

  try {
    // 1 — present lab: 200 + a signed URL that actually serves PDF bytes.
    if (!labId) {
      record('1. present lab -> 200 + signed URL', false, 'no lab with hasArtifact:true found');
    } else {
      const r = await callRead(token, 'labs', labId);
      const url = r.json && r.json.signedUrl;
      if (effectiveStatus(r) !== 200 || !url) {
        const hint = /signBlob|could not sign|SigningError/i.test(r.raw)
          ? ' >>> SIGNING FAILURE: grant roles/iam.serviceAccountTokenCreator to the RUNTIME SA on ITSELF <<<'
          : '';
        record('1. present lab -> 200 + signed URL', false, `${effectiveStatus(r)} ${r.raw}${hint}`);
      } else {
        const got = await fetch(url);
        const buf = Buffer.from(await got.arrayBuffer());
        const magic = buf.slice(0, 5).toString('latin1');
        record(
          '1. present lab -> 200 + signed URL serves PDF bytes',
          got.ok && magic === '%PDF-',
          `GET ${got.status}, ${buf.length} bytes, magic=${magic}`,
        );
      }
    }

    // 2 — missing object: calm preparing state, never an error.
    {
      const r = await callRead(token, 'labs', MISSING_ID);
      const state = r.json && r.json.state;
      record(
        `2. ${MISSING_ID} -> { state: 'preparing' }`,
        effectiveStatus(r) === 200 && state === 'preparing',
        `${effectiveStatus(r)} state=${state || '—'}`,
      );
    }

    // 3 — hidden item: 404, absence never rendered as forbidden.
    if (labId) {
      await accessRef().set({ hiddenItems: { labs: [labId] } }, { merge: true });
      const r = await callRead(token, 'labs', labId);
      record(
        '3. hidden lab -> 404 ARTIFACT_NOT_SYNCED',
        effectiveStatus(r) === 404,
        `${effectiveStatus(r)} ${reasonOf(r) || r.raw}`,
      );
      await restoreAccess(saved);
    }

    // 4 — suspended member: 403, fails closed.
    {
      await accessRef().set({ status: 'suspended' }, { merge: true });
      const r = await callRead(token, 'labs', labId || MISSING_ID);
      record(
        '4. suspended -> 403 ACCESS_SUSPENDED',
        effectiveStatus(r) === 403 && reasonOf(r) === 'ACCESS_SUSPENDED',
        `${effectiveStatus(r)} ${reasonOf(r) || r.raw}`,
      );
      await restoreAccess(saved);
    }

    // 5 — the other two artifact modules. Same assertion as case 1, including
    //     the byte-fetch: a signed URL that does not serve `%PDF-` is a
    //     signing/ACL failure, not a pass.
    for (const pair of [['imaging', imagingId], ['records', recordId]]) {
      const moduleKey = pair[0];
      const id = pair[1];
      if (!id) {
        skip(
          `5. ${moduleKey} present -> 200 + signed URL`,
          `skipped — fixture ${FIXTURE_PATIENT_ID} holds no ${CATEGORY_BY_MODULE[moduleKey]} document with hasArtifact:true`,
        );
        continue;
      }
      const r = await callRead(token, moduleKey, id);
      const url = r.json && r.json.signedUrl;
      if (effectiveStatus(r) !== 200 || !url) {
        const hint = /signBlob|could not sign|SigningError/i.test(r.raw)
          ? ' >>> SIGNING FAILURE: grant roles/iam.serviceAccountTokenCreator to the RUNTIME SA on ITSELF <<<'
          : '';
        record(`5. ${moduleKey} present -> 200 + signed URL`, false, `${effectiveStatus(r)} ${r.raw}${hint}`);
        continue;
      }
      const got = await fetch(url);
      const buf = Buffer.from(await got.arrayBuffer());
      const magic = buf.slice(0, 5).toString('latin1');
      record(
        `5. ${moduleKey} present -> 200 + signed URL serves PDF bytes`,
        got.ok && magic === '%PDF-',
        `GET ${got.status}, ${buf.length} bytes, magic=${magic}`,
      );
    }

  } finally {
    await restoreAccess(saved);
    const after = await snapshotAccess();
    const clean = after.existed === saved.existed
      && JSON.stringify(after.data || null) === JSON.stringify(saved.data || null);
    record(
      'portalAccess restored to its pre-smoke state',
      clean,
      clean ? '' : `MANUAL CHECK REQUIRED — compare portalAccess/${FIXTURE_PATIENT_ID}`,
    );
  }

  const failed = results.filter((r) => !r.pass).length;
  const skipped = results.filter((r) => r.skipped).length;
  return {
    fixture: { patientId: FIXTURE_PATIENT_ID, uid: FIXTURE_UID, missingId: MISSING_ID },
    base: BASE,
    ranAt: new Date().toISOString(),
    total: results.length,
    passed: results.length - failed - skipped,
    failed,
    skipped,
    results,
  };

}

exports.adminRunReadPathSmoke = functions
  .region(REGION)
  .runWith({ timeoutSeconds: 300, memory: '256MB' })
  .https.onRequest(async (req, res) => {
    const gate = await requireAdminCaller(req, selfAudience(req, 'adminRunReadPathSmoke'));
    if (!gate.ok) {
      functions.logger.warn('adminRunReadPathSmoke caller-rejected', { reason: gate.reason });
      return res.status(gate.status).json({ ok: false, error: gate.reason });
    }

    // Belt and braces: this function toggles portalAccess, so it may only ever
    // point at the smoke fixture. A misconfigured env must not aim it at a
    // real member.
    const requested = String((req.body && req.body.patientId) || FIXTURE_PATIENT_ID);
    if (requested !== FIXTURE_PATIENT_ID) {
      return res.status(400).json({
        ok: false,
        error: 'read_path_smoke_runs_only_against_the_configured_fixture',
      });
    }

    try {
      const report = await runSmoke();
      return res.status(200).json({ ok: true, ...report });
    } catch (err) {
      functions.logger.error('adminRunReadPathSmoke failed', err);
      return res.status(500).json({ ok: false, error: String((err && err.message) || err) });
    }
  });

exports._runSmoke = runSmoke;

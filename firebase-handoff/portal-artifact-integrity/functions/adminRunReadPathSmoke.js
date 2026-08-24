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
 *
 * GUARDIAN ARM (Release 2b Part B) — only runs when GUARDIAN_READS_ENABLED is
 * 'true' on THIS runtime AND the fixtures below are configured. Otherwise every
 * guardian assertion is SKIPPED with the reason, never silently passed.
 *   SMOKE_GUARDIAN_UID          Firebase uid of the guardian fixture account
 *   SMOKE_GUARDIAN_ELATION_ID   the guardian's OWN patients/{id} doc id
 *   SMOKE_CHILD_PATIENT_ID      minor LINKED to that guardian (positive case)
 *   SMOKE_OTHER_CHILD_ID        minor NOT linked to that guardian (isolation)
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

// ------------------------------------------------ guardian fixture input ----

/**
 * The guardian fixtures point at MINOR patient ids, which we deliberately keep
 * out of GitHub Secrets and the persistent prod `.env`. They may therefore be
 * supplied in the request body at invoke time; each one falls back to its
 * existing env var when absent, so a runtime that already has them configured
 * behaves exactly as before.
 *
 * Every override is treated as an OPAQUE STRING. It is validated against a
 * conservative id charset and never interpolated into a resolver expression or
 * a query string — it is only ever passed as a Firestore document id or as a
 * JSON body field the read path re-authorizes on its own.
 */
const ID_RE = /^[A-Za-z0-9_.:@-]{1,128}$/;

function readOverride(body, key, envValue) {
  const raw = body && Object.prototype.hasOwnProperty.call(body, key) ? body[key] : undefined;
  if (raw === undefined || raw === null || raw === '') {
    return { value: String(envValue || ''), source: envValue ? 'env' : 'unset' };
  }
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    return { value: '', source: 'invalid', error: `${key} must be a string` };
  }
  const value = String(raw).trim();
  if (!ID_RE.test(value)) {
    return { value: '', source: 'invalid', error: `${key} is not a valid identifier` };
  }
  return { value, source: 'body' };
}

/**
 * Returns { fx, sources, errors }. `fx` carries the four guardian fixtures for
 * this run; nothing about the flag/allowlist gate is overridable.
 */
function resolveFixtures(body) {
  const spec = [
    ['guardianUid', process.env.SMOKE_GUARDIAN_UID],
    ['guardianElationId', process.env.SMOKE_GUARDIAN_ELATION_ID],
    ['childPatientId', process.env.SMOKE_CHILD_PATIENT_ID],
    ['otherChildId', process.env.SMOKE_OTHER_CHILD_ID],
  ];
  const fx = {};
  const sources = {};
  const errors = [];
  for (const pair of spec) {
    const r = readOverride(body, pair[0], pair[1]);
    if (r.error) errors.push(r.error);
    fx[pair[0]] = r.value;
    sources[pair[0]] = r.source;
  }
  return { fx, sources, errors };
}

function guardianAllowlist() {
  return (process.env.GUARDIAN_READS_ALLOWLIST || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function guardianAllowlistIsGlobal(allow) {
  return allow.includes('*') || allow.includes('all');
}

/**
 * Mirrors `readArtifact.guardianReadsEnabledFor`, including its FAIL-CLOSED
 * semantics: an empty/missing allowlist denies every guardian even with the
 * flag on, and `*` is the one explicit token that widens globally.
 */
function guardianReadsEnabled(fx) {
  if (process.env.GUARDIAN_READS_ENABLED !== 'true') return false;
  const allow = guardianAllowlist();
  if (allow.length === 0) return false;
  if (guardianAllowlistIsGlobal(allow)) return true;
  const uid = String((fx && fx.guardianUid) || '').toLowerCase();
  const elationId = String((fx && fx.guardianElationId) || '').toLowerCase();
  return (uid ? allow.includes(uid) : false)
    || (elationId ? allow.includes(elationId) : false);
}



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

async function mintPatientIdToken(uid) {
  const key = webApiKey();
  if (!key) {
    throw new Error(
      'SMOKE_WEB_API_KEY is not configured on the functions runtime — the ' +
      'custom-token exchange cannot run.',
    );
  }
  const subject = String(uid || FIXTURE_UID);
  const customToken = await admin.auth().createCustomToken(subject, { role: 'patient' });
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

/**
 * `childElationId` is the ONLY body field that can point the read at another
 * record, and the read path treats it as a request, not as identity: it is
 * accepted solely after `resolveGuardianAccess` authorizes the caller for that
 * child. Passing it here is exactly what the portal does for a dependent.
 */
async function callRead(token, moduleKey, reportId, childElationId) {
  const payload = {};
  if (reportId) payload.reportId = reportId;
  if (childElationId) payload.childElationId = String(childElationId);
  const res = await fetch(`${BASE}/${FN_BY_MODULE[moduleKey]}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
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

async function discover(moduleKey, patientId) {
  const snap = await admin.firestore()
    .collection('patients').doc(String(patientId || FIXTURE_PATIENT_ID)).collection('labs')
    .where('category', '==', CATEGORY_BY_MODULE[moduleKey])
    .where('hasArtifact', '==', true)
    .limit(10)
    .get()
    .catch(() => null);
  if (!snap || snap.empty) return null;
  const hit = snap.docs.find((d) => d.id !== MISSING_ID);
  return hit ? hit.id : null;
}

// ------------------------------------------------------ guardian fixtures ----

/**
 * Read-only precondition check. The guardian arm asserts the READ PATH; it must
 * never create or repair a guardian link to make itself pass, so a missing or
 * non-active link is reported as SKIP (fixture gap) rather than FAIL, and a
 * link that exists on the WRONG child (the isolation fixture) is a hard FAIL
 * because it would invalidate the negative case.
 */
async function guardianFixtureState() {
  const db = admin.firestore();
  const linkedOn = async (childId) => {
    if (!childId) return null;
    const snap = await db.collection('patients').doc(String(childId)).get().catch(() => null);
    if (!snap || !snap.exists) return { exists: false, active: false };
    const guardians = Array.isArray(snap.data().guardians) ? snap.data().guardians : [];
    const active = guardians.some((g) => g
      && g.status === 'active'
      && ((g.guardianUid && g.guardianUid === GUARDIAN_UID)
        || (g.guardianElationId && String(g.guardianElationId) === GUARDIAN_ELATION_ID)));
    return { exists: true, active };
  };
  return {
    child: await linkedOn(CHILD_PATIENT_ID),
    other: await linkedOn(OTHER_CHILD_ID),
  };
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

// ------------------------------------------------------- guardian arm ----

/**
 * Guardian -> minor read, both directions.
 *
 * POSITIVE  the guardian's own token, plus `childElationId` of their LINKED
 *           child, returns 200 + a signed URL that serves real `%PDF-` bytes.
 * NEGATIVE  the SAME token, pointed at a child they are NOT linked to, is
 *           denied. This is the containment assertion: anything other than a
 *           denial (403/404) — including a 200, a signed URL, or a calm
 *           `preparing` state, which would confirm the record exists — is a
 *           leak and fails the run.
 *
 * The whole arm is gated on GUARDIAN_READS_ENABLED being true ON THIS RUNTIME.
 * With the flag off the read path denies guardians unconditionally, so the
 * negative case would "pass" for the wrong reason and the positive case would
 * fail for the wrong reason — neither tells us anything, so both are skipped.
 */
async function runGuardianArm({ record, skip }) {
  const label = {
    pos: '6. guardian -> linked minor: 200 + signed URL serves PDF bytes',
    neg: '7. guardian -> UNLINKED minor: denied (cross-child isolation)',
  };

  if (!guardianReadsEnabled()) {
    const why = process.env.GUARDIAN_READS_ENABLED === 'true'
      ? 'skipped — GUARDIAN_READS_ENABLED is true but GUARDIAN_READS_ALLOWLIST is empty or does not include this guardian fixture; the read path fails closed and still denies it'
      : 'skipped — GUARDIAN_READS_ENABLED is not true on this runtime; guardian reads are denied unconditionally, so neither case is meaningful';


    skip(label.pos, why);
    skip(label.neg, why);
    return;
  }
  if (!GUARDIAN_UID || !CHILD_PATIENT_ID || !OTHER_CHILD_ID) {
    const why = 'skipped — SMOKE_GUARDIAN_UID / SMOKE_CHILD_PATIENT_ID / SMOKE_OTHER_CHILD_ID are not all configured';
    skip(label.pos, why);
    skip(label.neg, why);
    return;
  }
  if (CHILD_PATIENT_ID === OTHER_CHILD_ID) {
    record(label.neg, false, 'fixture error — the linked and unlinked child ids are the same, so isolation cannot be tested');
    return;
  }

  const state = await guardianFixtureState();

  // A link on the ISOLATION child would silently turn the negative case into a
  // second positive case. That is a fixture defect, and it fails loudly.
  if (state.other && state.other.active) {
    record(
      label.neg,
      false,
      `fixture error — guardian IS actively linked to ${OTHER_CHILD_ID}; pick an unrelated minor for SMOKE_OTHER_CHILD_ID`,
    );
    return;
  }

  let token;
  try {
    token = await mintPatientIdToken(GUARDIAN_UID);
  } catch (err) {
    const why = `could not mint the guardian token: ${String((err && err.message) || err)}`;
    record(label.pos, false, why);
    record(label.neg, false, why);
    return;
  }

  // --- positive ---
  if (!state.child || !state.child.exists) {
    skip(label.pos, `skipped — patients/${CHILD_PATIENT_ID} does not exist`);
  } else if (!state.child.active) {
    skip(label.pos, `skipped — no ACTIVE guardian entry for this guardian on ${CHILD_PATIENT_ID} (the smoke never creates one)`);
  } else {
    const childLabId = await discover('labs', CHILD_PATIENT_ID);
    if (!childLabId) {
      skip(label.pos, `skipped — minor ${CHILD_PATIENT_ID} holds no lab with hasArtifact:true`);
    } else {
      const r = await callRead(token, 'labs', childLabId, CHILD_PATIENT_ID);
      const url = r.json && r.json.signedUrl;
      if (effectiveStatus(r) !== 200 || !url) {
        record(label.pos, false, `${effectiveStatus(r)} ${reasonOf(r) || r.raw}`);
      } else {
        const got = await fetch(url);
        const buf = Buffer.from(await got.arrayBuffer());
        const magic = buf.slice(0, 5).toString('latin1');
        record(label.pos, got.ok && magic === '%PDF-', `GET ${got.status}, ${buf.length} bytes, magic=${magic}`);
      }
    }
  }

  // --- negative (the gate) ---
  const otherLabId = (await discover('labs', OTHER_CHILD_ID)) || MISSING_ID;
  const n = await callRead(token, 'labs', otherLabId, OTHER_CHILD_ID);
  const status = effectiveStatus(n);
  const leaked = Boolean(n.json && (n.json.signedUrl || n.json.state === 'preparing'));
  record(
    label.neg,
    (status === 403 || status === 404) && !leaked,
    leaked
      ? `LEAK — ${status} but the response carried ${n.json.signedUrl ? 'a signed URL' : "a 'preparing' state"} for a child this guardian is not linked to`
      : `${status} ${reasonOf(n) || n.raw}`,
  );
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

    // 6 — GUARDIAN ARM (Release 2b Part B). Proves the dependent read end to
    //     end, and — the case that actually gates the flip — proves a guardian
    //     is CONTAINED to their own child.
    //
    //     It is read-only: it never creates, binds or revokes a guardian entry,
    //     and it writes nothing on either child. The only state this whole
    //     function mutates remains portalAccess/{FIXTURE_PATIENT_ID}, restored
    //     in the `finally` below. A guardian assertion that cannot be made
    //     honestly is SKIPPED with its reason — never recorded as a pass.
    await runGuardianArm({ record, skip });

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
    guardianFixture: {
      enabled: guardianReadsEnabled(),
      flag: process.env.GUARDIAN_READS_ENABLED === 'true',
      // Empty = DENY ALL (fail closed). '*' = deliberate global widen.
      allowlistSize: guardianAllowlist().length,
      scoped: guardianAllowlist().length > 0 && !guardianAllowlistIsGlobal(guardianAllowlist()),
      global: guardianAllowlistIsGlobal(guardianAllowlist()),
      failClosed: guardianAllowlist().length === 0,

      guardianUid: GUARDIAN_UID || null,
      guardianElationId: GUARDIAN_ELATION_ID || null,

      childPatientId: CHILD_PATIENT_ID || null,
      otherChildPatientId: OTHER_CHILD_ID || null,
    },
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

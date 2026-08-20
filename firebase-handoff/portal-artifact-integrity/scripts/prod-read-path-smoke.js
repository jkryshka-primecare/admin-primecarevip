#!/usr/bin/env node
/**
 * Release 2a · item 4 — LIVE read-path smoke against the DEPLOYED functions.
 *
 * Run in Cloud Shell (prod ADC). Targets the real https endpoints for
 * getLabs / getImaging / getMedicalRecords as a real patient bearer token,
 * and proves the one thing the emulator could not: a v4 signed URL minted in
 * production actually serves PDF bytes.
 *
 * WHAT IT WRITES
 *   Nothing on the member's chart. It flips `portalAccess/{patientId}` twice
 *   (module hidden, then status suspended) and RESTORES the original document
 *   verbatim in a finally block — including deleting the doc again if it did
 *   not exist when we started. Every read is audited by the functions
 *   themselves (phi_access_log), which is expected and desirable.
 *
 * USAGE
 *   export PROJECT_ID=prive-care-vip
 *   export REGION=us-central1
 *   export SMOKE_WEB_API_KEY=<Firebase Web API key>     # required for token exchange
 *   export SMOKE_PATIENT_ID=816455979040769             # Test Kieffer fixture
 *   export SMOKE_FIREBASE_UID=d8h7h6xc6axkq3k3tgnoz6ytxmx1
 *   node prod-read-path-smoke.js
 *
 * Optional overrides (otherwise auto-discovered from Firestore):
 *   SMOKE_LAB_ID, SMOKE_IMAGING_ID, SMOKE_RECORD_ID
 *   SMOKE_MISSING_ID   (default SMOKE-LAB-2 — the known reference with no object)
 *   FUNCTIONS_BASE     (default https://$REGION-$PROJECT_ID.cloudfunctions.net)
 */

/* eslint-disable no-console */
const admin = require('firebase-admin');

const PROJECT_ID = process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || 'prive-care-vip';
const REGION = process.env.REGION || 'us-central1';
const BASE = process.env.FUNCTIONS_BASE || `https://${REGION}-${PROJECT_ID}.cloudfunctions.net`;
const API_KEY = process.env.SMOKE_WEB_API_KEY || '';
const PATIENT_ID = String(process.env.SMOKE_PATIENT_ID || '816455979040769');
const UID = String(process.env.SMOKE_FIREBASE_UID || 'd8h7h6xc6axkq3k3tgnoz6ytxmx1');
const MISSING_ID = process.env.SMOKE_MISSING_ID || 'SMOKE-LAB-2';

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

function die(msg) {
  console.error(`\nABORT: ${msg}`);
  process.exit(2);
}

// ---------------------------------------------------------------- auth ----

/**
 * Mint a patient ID token: custom token (needs signBlob on the caller) then
 * the Identity Toolkit exchange, exactly like the red-team harness.
 */
async function mintIdToken() {
  let customToken;
  try {
    customToken = await admin.auth().createCustomToken(UID, { role: 'patient' });
  } catch (err) {
    const m = String(err && err.message);
    if (/signBlob|sign|IAM/i.test(m)) {
      die(
        'could not mint a custom token — the caller lacks signing rights.\n' +
        '  FIX: grant roles/iam.serviceAccountTokenCreator to the caller on the\n' +
        `       service account it impersonates (in Cloud Shell, usually your own\n` +
        `       user on ${PROJECT_ID}@appspot.gserviceaccount.com).\n` +
        `  raw: ${m}`,
      );
    }
    die(`createCustomToken failed: ${m}`);
  }

  if (!API_KEY) die('SMOKE_WEB_API_KEY is required for the custom-token exchange.');
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.idToken) {
    die(`token exchange failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body.idToken;
}

// ------------------------------------------------------------- calling ----

const FN_BY_MODULE = { labs: 'getLabs', imaging: 'getImaging', records: 'getMedicalRecords' };

async function callRead(token, moduleKey, reportId) {
  const fn = FN_BY_MODULE[moduleKey];
  const res = await fetch(`${BASE}/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(reportId ? { reportId } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep raw */ }
  return { status: res.status, json, raw: text.slice(0, 400) };
}

/** The functions answer 200 with an error envelope in some paths; normalize. */
function effectiveStatus(r) {
  const inner = r.json && r.json.error && r.json.error.code;
  return typeof inner === 'number' ? inner : r.status;
}

function reasonOf(r) {
  return (r.json && r.json.error && r.json.error.details && r.json.error.details.reason) || '';
}

// ------------------------------------------------------------ discovery ----

async function discover(moduleKey, envValue) {
  if (envValue) return envValue;
  const col = moduleKey === 'labs' ? 'labs' : moduleKey === 'imaging' ? 'imaging' : 'records';
  const snap = await admin.firestore()
    .collection('patients').doc(PATIENT_ID).collection(col)
    .where('hasArtifact', '==', true)
    .limit(10)
    .get()
    .catch(() => null);
  if (!snap || snap.empty) return null;
  const hit = snap.docs.find((d) => d.id !== MISSING_ID);
  return hit ? hit.id : null;
}

// ------------------------------------------------- portalAccess toggling ----

const accessRef = () => admin.firestore().collection('portalAccess').doc(PATIENT_ID);

async function snapshotAccess() {
  const snap = await accessRef().get();
  return { existed: snap.exists, data: snap.exists ? snap.data() : null };
}

async function restoreAccess(saved) {
  if (!saved.existed) { await accessRef().delete().catch(() => {}); return; }
  await accessRef().set(saved.data); // full overwrite — byte-for-byte restore
}

// ----------------------------------------------------------------- main ----

async function main() {
  admin.initializeApp({ projectId: PROJECT_ID });
  console.log(`Prime Care VIP — prod read-path smoke`);
  console.log(`  project ${PROJECT_ID}   base ${BASE}`);
  console.log(`  patient ${PATIENT_ID}   uid ${UID}\n`);

  const token = await mintIdToken();
  record('mint patient ID token', true, 'custom token + identitytoolkit exchange');

  const labId = await discover('labs', process.env.SMOKE_LAB_ID);
  const imagingId = await discover('imaging', process.env.SMOKE_IMAGING_ID);
  const recordId = await discover('records', process.env.SMOKE_RECORD_ID);
  console.log(`  fixtures: lab=${labId || '—'} imaging=${imagingId || '—'} record=${recordId || '—'}\n`);

  const saved = await snapshotAccess();

  try {
    // 1 — present lab: 200 + signed URL that actually serves PDF bytes.
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
        const isPdf = buf.slice(0, 5).toString('latin1') === '%PDF-';
        record(
          '1. present lab -> 200 + signed URL serves PDF bytes',
          got.ok && isPdf,
          `GET ${got.status}, ${buf.length} bytes, magic=${buf.slice(0, 5).toString('latin1')}`,
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

    // 5 — the other two artifact modules.
    for (const [moduleKey, id] of [['imaging', imagingId], ['records', recordId]]) {
      if (!id) {
        record(`5. ${moduleKey} present -> 200 + signed URL`, false, 'no fixture with hasArtifact:true');
        continue;
      }
      const r = await callRead(token, moduleKey, id);
      const url = r.json && r.json.signedUrl;
      record(
        `5. ${moduleKey} present -> 200 + signed URL`,
        effectiveStatus(r) === 200 && Boolean(url),
        `${effectiveStatus(r)} ${url ? 'signed URL returned' : r.raw}`,
      );
    }
  } finally {
    await restoreAccess(saved);
    const after = await snapshotAccess();
    const clean = after.existed === saved.existed
      && JSON.stringify(after.data || null) === JSON.stringify(saved.data || null);
    record('portalAccess restored to its pre-smoke state', clean,
      clean ? '' : 'MANUAL CHECK REQUIRED — compare portalAccess/' + PATIENT_ID);
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('FAILED:');
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => die(String(err && err.stack ? err.stack : err)));

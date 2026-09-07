#!/usr/bin/env node
/**
 * Isolation fixture — a SECOND test minor that is a real, readable patient but
 * is NOT linked to the smoke guardian. This is `SMOKE_OTHER_CHILD_ID` for the
 * negative (containment) assertion in adminRunReadPathSmoke:
 *
 *   the guardian's own token, pointed at THIS child, must be denied.
 *
 * Why it carries a real lab with a real artifact: a denial against an empty
 * chart proves nothing (absence and refusal look the same). This child holds a
 * genuine viewable report, so a 403/404 can only come from the guardian gate.
 *
 * Standalone: needs only `firebase-admin` + ADC. DRY RUN by default.
 *   node seed-isolation-minor-fixture.js            # dry run
 *   node seed-isolation-minor-fixture.js --apply
 *   node seed-isolation-minor-fixture.js --cleanup --apply
 *
 * Safety, identical to seed-guardian-fixture.js:
 *   - every id / email / name is a PINNED CONSTANT below, never argv;
 *   - refuses to touch any doc that exists without `_testSeed: true`;
 *   - the id is non-numeric, so the Elation poller and the report backfill can
 *     never collide with it;
 *   - it writes NO `guardians` array — being unlinked is the whole point, and
 *     the canary hard-FAILS the run if this child ever acquires an active link.
 */

const admin = require('firebase-admin');

// ---------------------------------------------------------------- constants
const BUCKET = 'prive-care-vip.firebasestorage.app';

const OTHER_MINOR = {
  id: 'SMOKE-MINOR-2',
  uid: 'smokeminoruid00000000000002', // internal uid; minors never sign in
  email: 'isolation-test-2@primecarevip.com', // no guardian inbox, by design
  firstName: 'Test',
  lastName: 'Unrelated',
  dob: '2016-03-09',
};

const LAB_ID = 'SMOKE-ISOLATION-LAB-1';
const ACTOR = 'fixture-script@primecarevip.com';

const APPLY = process.argv.includes('--apply');
const CLEANUP = process.argv.includes('--cleanup');

admin.initializeApp({ storageBucket: BUCKET });
const db = admin.firestore();
const bucket = admin.storage().bucket(BUCKET);

const objectPath = (uid, reportId) =>
  `elation-artifacts/${String(uid).toLowerCase()}/${reportId}/report.pdf`;

function say(action, detail) {
  console.log(`${APPLY ? '[apply]  ' : '[dryrun] '}${action}`, detail || '');
}

/** Refuse to write over anything that is not one of ours. */
async function assertSafe(ref) {
  const snap = await ref.get();
  if (snap.exists && snap.data()._testSeed !== true) {
    throw new Error(`refusing to touch non-fixture doc ${ref.path}`);
  }
  return snap.exists;
}

/** Refuse to proceed if somebody linked a guardian onto the isolation child. */
async function assertUnlinked(ref) {
  const snap = await ref.get();
  if (!snap.exists) return;
  const guardians = Array.isArray(snap.data().guardians) ? snap.data().guardians : [];
  const active = guardians.filter((g) => g && g.status === 'active');
  if (active.length) {
    throw new Error(
      `${ref.path} has ${active.length} ACTIVE guardian link(s) — it cannot serve as the ` +
      'isolation fixture. Revoke them, or pick a different unrelated minor.',
    );
  }
}

function dummyPdf(label) {
  const text = `TEST FIXTURE - ${label}`;
  const content = `BT /F1 18 Tf 60 700 Td (${text}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => { pdf += `${String(o).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

// -------------------------------------------------------------------- seed
async function seed() {
  const ref = db.collection('patients').doc(OTHER_MINOR.id);
  await assertSafe(ref);
  await assertUnlinked(ref);

  const now = admin.firestore.Timestamp.now();

  const minorDoc = {
    _testSeed: true,
    elationPatientId: OTHER_MINOR.id,
    firstName: OTHER_MINOR.firstName,
    lastName: OTHER_MINOR.lastName,
    email: OTHER_MINOR.email,
    dob: OTHER_MINOR.dob,
    internalUid: OTHER_MINOR.uid,
    claimed: false,
    membershipStatus: 'active',
    deleted: false,
    dependent: {
      isMinor: true,
      dob: OTHER_MINOR.dob,
      convertsAt: admin.firestore.Timestamp.fromDate(
        new Date(`${Number(OTHER_MINOR.dob.slice(0, 4)) + 18}${OTHER_MINOR.dob.slice(4)}T00:00:00Z`),
      ),
    },
    // NO `guardians` array — this child is deliberately unlinked.
  };

  const labDoc = {
    _testSeed: true,
    reportId: LAB_ID,
    category: 'lab',
    name: 'Basic Metabolic Panel (isolation fixture)',
    signed: true,
    deleted: false,
    hasArtifact: true,
    reportDate: new Date().toISOString().slice(0, 10),
    results: [
      { name: 'NA', value: '139', units: 'mmol/L', range: '135-145' },
      { name: 'K', value: '4.1', units: 'mmol/L', range: '3.5-5.1' },
    ],
    createdAt: now,
  };

  say('write patients/' + OTHER_MINOR.id, '(unlinked minor — isolation fixture)');
  say(`write patients/${OTHER_MINOR.id}/labs/${LAB_ID}`);
  say('upload ' + objectPath(OTHER_MINOR.uid, LAB_ID));

  if (!APPLY) return;

  await ref.set(minorDoc, { merge: true });
  await ref.collection('labs').doc(LAB_ID).set(labDoc, { merge: true });
  await bucket.file(objectPath(OTHER_MINOR.uid, LAB_ID)).save(dummyPdf(LAB_ID), {
    contentType: 'application/pdf',
    resumable: false,
  });

  await db.collection('portalAdminAudit').add({
    at: now,
    action: 'isolation_fixture_seeded',
    elationPatientId: OTHER_MINOR.id,
    actor: ACTOR,
    reason: 'guardian containment (negative) assertion fixture',
    ok: true,
  });
}

// ----------------------------------------------------------------- cleanup
async function cleanup() {
  const ref = db.collection('patients').doc(OTHER_MINOR.id);
  await assertSafe(ref);

  say('delete ' + `patients/${OTHER_MINOR.id}/labs/${LAB_ID}`);
  say('delete ' + objectPath(OTHER_MINOR.uid, LAB_ID));
  say('delete patients/' + OTHER_MINOR.id);
  if (!APPLY) return;

  await ref.collection('labs').doc(LAB_ID).delete();
  await bucket.file(objectPath(OTHER_MINOR.uid, LAB_ID)).delete({ ignoreNotFound: true });
  await ref.delete();
}

// -------------------------------------------------------------------- main
(async () => {
  try {
    if (CLEANUP) await cleanup();
    else await seed();

    if (!CLEANUP && APPLY) {
      console.log('\nIsolation fixture ready.');
      console.log(`  otherChildId = ${OTHER_MINOR.id}`);
      console.log('  Add it to ELATION_READ_ALLOWLIST so the denial comes from the');
      console.log('  GUARDIAN gate, not from the account-level records gate.');
    }
    console.log(APPLY ? '\nDone.' : '\nDry run only — re-run with --apply to write.');
    process.exit(0);
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exit(1);
  }
})();

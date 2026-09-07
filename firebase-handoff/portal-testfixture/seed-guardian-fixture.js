#!/usr/bin/env node
/**
 * Guardian test fixture — one guardian account + one minor dependent, with a
 * real artifact on the child so the guardian read path can be exercised
 * end to end (list -> artifact -> signed URL -> phi_access_log both-uids line).
 *
 * Copy into the portal repo's `scripts/` and run from the repo root
 * (needs `firebase-admin` + ADC). DRY RUN by default; `--apply` writes.
 * `--cleanup --apply` removes everything this script created.
 *
 * What it writes (Admin SDK only, never Elation / Hint / portalAccess):
 *   patients/<GUARDIAN_ID>                 guardian roster doc (claimed, active)
 *   patients/<MINOR_ID>                    minor roster doc, `dependent` block,
 *                                          `guardians[]` with one active entry
 *   patients/<MINOR_ID>/labs/SMOKE-GUARDIAN-LAB-1
 *   gs://<bucket>/elation-artifacts/<minor internal uid>/SMOKE-GUARDIAN-LAB-1/report.pdf
 *
 * Safety, same pattern as seed-test-lab-artifacts.js:
 *   - ids, uids and emails are PINNED CONSTANTS below, never argv;
 *   - the script refuses to touch a doc that exists and is NOT marked
 *     `_testSeed: true` (so it can never clobber a real patient);
 *   - the synthetic doc ids are non-numeric, so the Elation poller and the
 *     report backfill can never collide with them.
 *
 * After seeding, guardian reads still need the canary flags — the child is NOT
 * the key. Set on the functions runtime:
 *     GUARDIAN_READS_ENABLED=true
 *     GUARDIAN_READS_ALLOWLIST=<guardian uid or guardian's OWN elation id>
 * An empty allowlist denies every guardian even with the flag on (fail closed).
 */

const admin = require('firebase-admin');

// ---------------------------------------------------------------- constants
const BUCKET = 'prive-care-vip.firebasestorage.app';

const GUARDIAN = {
  id: 'SMOKE-GUARDIAN-1',
  uid: 'smokeguardianuid000000000001',
  email: 'guardian-test-1@primecarevip.com',
  firstName: 'Test',
  lastName: 'Guardian',
  dob: '1985-04-12',
};

const MINOR = {
  id: 'SMOKE-MINOR-1',
  uid: 'smokeminoruid00000000000001', // internal uid; minors never sign in
  email: 'guardian-test-1@primecarevip.com', // guardian's inbox, by design
  firstName: 'Test',
  lastName: 'Dependent',
  dob: '2015-06-01',
};

const LAB_ID = 'SMOKE-GUARDIAN-LAB-1';
const ACTOR = 'fixture-script@primecarevip.com';
const REASON = 'guardian read-path smoke fixture';

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

function dummyPdf(label) {
  // Minimal single-page PDF that renders in a browser, watermarked.
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
  const guardianRef = db.collection('patients').doc(GUARDIAN.id);
  const minorRef = db.collection('patients').doc(MINOR.id);
  await assertSafe(guardianRef);
  await assertSafe(minorRef);

  const now = admin.firestore.Timestamp.now();

  const guardianDoc = {
    _testSeed: true,
    elationPatientId: GUARDIAN.id,
    firstName: GUARDIAN.firstName,
    lastName: GUARDIAN.lastName,
    email: GUARDIAN.email,
    dob: GUARDIAN.dob,
    firebaseUid: GUARDIAN.uid,
    internalUid: GUARDIAN.uid,
    claimed: true,
    claimedAt: now,
    webAccessVerifiedAt: now,
    membershipStatus: 'active',
    deleted: false,
  };

  const minorDoc = {
    _testSeed: true,
    elationPatientId: MINOR.id,
    firstName: MINOR.firstName,
    lastName: MINOR.lastName,
    email: MINOR.email,
    dob: MINOR.dob,
    internalUid: MINOR.uid,
    claimed: false, // minors get no login, by decision
    membershipStatus: 'active',
    deleted: false,
    dependent: {
      isMinor: true,
      dob: MINOR.dob,
      convertsAt: admin.firestore.Timestamp.fromDate(
        new Date(`${Number(MINOR.dob.slice(0, 4)) + 18}${MINOR.dob.slice(4)}T00:00:00Z`),
      ),
    },
    guardians: [
      {
        guardianElationId: GUARDIAN.id,
        guardianUid: GUARDIAN.uid,
        guardianEmail: GUARDIAN.email,
        guardianName: `${GUARDIAN.firstName} ${GUARDIAN.lastName}`,
        source: 'manual',
        status: 'active',
        confirmedBy: ACTOR,
        confirmedAt: now,
        reason: REASON,
      },
    ],
  };

  const labDoc = {
    _testSeed: true,
    reportId: LAB_ID,
    category: 'lab',
    name: 'CBC with Differential (fixture)',
    signed: true,
    deleted: false,
    hasArtifact: true,
    reportDate: new Date().toISOString().slice(0, 10),
    results: [
      { name: 'WBC', value: '6.2', units: 'K/uL', range: '4.0-11.0' },
      { name: 'HGB', value: '13.4', units: 'g/dL', range: '12.0-16.0' },
      { name: 'PLT', value: '244', units: 'K/uL', range: '150-400' },
    ],
    createdAt: now,
  };

  say('write patients/' + GUARDIAN.id, '(claimed guardian)');
  say('write patients/' + MINOR.id, '(minor + dependent + 1 active guardian)');
  say(`write patients/${MINOR.id}/labs/${LAB_ID}`);
  say('upload ' + objectPath(MINOR.uid, LAB_ID));

  if (!APPLY) return;

  await guardianRef.set(guardianDoc, { merge: true });
  await minorRef.set(minorDoc, { merge: true });
  await minorRef.collection('labs').doc(LAB_ID).set(labDoc, { merge: true });
  await bucket.file(objectPath(MINOR.uid, LAB_ID)).save(dummyPdf(LAB_ID), {
    contentType: 'application/pdf',
    resumable: false,
  });

  await db.collection('portalAdminAudit').add({
    at: now,
    action: 'guardian_linked',
    elationPatientId: MINOR.id,
    actor: ACTOR,
    reason: REASON,
    created: true,
    source: 'manual',
    guardianRef: GUARDIAN.id,
    ok: true,
  });
}

// ----------------------------------------------------------------- cleanup
async function cleanup() {
  const refs = [db.collection('patients').doc(GUARDIAN.id), db.collection('patients').doc(MINOR.id)];
  for (const ref of refs) await assertSafe(ref);

  say('delete ' + `patients/${MINOR.id}/labs/${LAB_ID}`);
  say('delete ' + objectPath(MINOR.uid, LAB_ID));
  say('delete patients/' + MINOR.id);
  say('delete patients/' + GUARDIAN.id);
  if (!APPLY) return;

  await db.collection('patients').doc(MINOR.id).collection('labs').doc(LAB_ID).delete();
  await bucket.file(objectPath(MINOR.uid, LAB_ID)).delete({ ignoreNotFound: true });
  await db.collection('patients').doc(MINOR.id).delete();
  await db.collection('patients').doc(GUARDIAN.id).delete();
}

// -------------------------------------------------------------------- main
(async () => {
  try {
    if (CLEANUP) await cleanup();
    else await seed();

    if (!CLEANUP) {
      console.log('\nNext, on the functions runtime:');
      console.log('  GUARDIAN_READS_ENABLED=true');
      console.log(`  GUARDIAN_READS_ALLOWLIST=${GUARDIAN.uid},${GUARDIAN.id}`);
      console.log('\nGuardian signs in as', GUARDIAN.email, '-> switch into', `${MINOR.firstName} ${MINOR.lastName}`);
      console.log('Expect: child lab listed, artifact 200 with a ~30 min signed URL,');
      console.log('and a phi_access_log line where actingUid != subjectUid.');
    }
    console.log(APPLY ? '\nDone.' : '\nDry run only — re-run with --apply to write.');
    process.exit(0);
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exit(1);
  }
})();

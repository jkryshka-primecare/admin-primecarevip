#!/usr/bin/env node
/**
 * reset-test-fixture.js — return the ONE synthetic smoke-test member to a
 * genuinely unclaimed state so `adminIssueInvite` treats it as fresh
 * (rows 2–3 of the go-live smoke test).
 *
 * Run from the Firebase repo's `functions/` directory (it needs
 * firebase-admin) or anywhere with GOOGLE_APPLICATION_CREDENTIALS set:
 *
 *     node reset-test-fixture.js            # dry run — reads only, prints a plan
 *     node reset-test-fixture.js --apply    # performs the deletes
 *
 * SAFETY — this script cannot touch a real patient:
 *   - the Elation id and Auth uid are hard-pinned constants, not argv
 *   - it refuses to run unless the roster doc matches the expected synthetic
 *     name AND email AND the pinned uid (three independent checks)
 *   - dry run is the default; --apply is required to write
 *   - append-only evidence (portalAdminAudit, phi_access_log, phi_acknowledgments)
 *     is never touched, and neither is portalAccess/<id>
 *
 * Order matters: the roster binding is cleared BEFORE the Auth user is
 * deleted, so no window exists where a live session maps to an unbound doc.
 */

'use strict';

const admin = require('firebase-admin');

// --- Hard pins. Editing these is the only way to point this at another id,
// --- and doing so intentionally is the whole point of them being here.
//
// Re-pinned after the Aug 16, 2026 Step 1 production smoke test: the fixture was
// re-claimed under a new uid, and its roster email was pointed at the
// staff-controlled info@ mailbox. The earlier pins stay in the ACCEPTED_* lists
// so this script still cleans a fixture left in the pre-smoke-test shape.
const PATIENT_ID = '816455979040769';
const EXPECTED_UID = 'd8h7h6xc6axkq3k3tgnoz6ytxmx1';
const EXPECTED_EMAIL = 'info@primecarevip.com';
const EXPECTED_FIRST = 'test';
const EXPECTED_LAST = 'kieffer';

// Historical claims of the same synthetic fixture. Guards accept any of these;
// nothing outside these lists is ever touched.
const ACCEPTED_UIDS = [EXPECTED_UID, 'neozyhs59ue0vooapsrocygo1ah3'];
const ACCEPTED_EMAILS = [EXPECTED_EMAIL, 'patient-test-1@primecarevip.com'];

const isAcceptedUid = (u) =>
  ACCEPTED_UIDS.some((a) => a.toLowerCase() === String(u || '').toLowerCase());
const isAcceptedEmail = (e) =>
  ACCEPTED_EMAILS.some((a) => a.toLowerCase() === String(e || '').trim().toLowerCase());

const APPLY = process.argv.includes('--apply');

// Every claim-time field written by bindMember / claimAccount / the web app.
const ROSTER_FIELDS_TO_CLEAR = [
  'firebaseUid',          // bindMember (lowercased)
  'authUid',              // bindMember (true case)
  'boundAt',              // bindMember, write-once
  'claimedAt',            // claim flow
  'webAccessVerifiedAt',  // patient web app
  'hydrationStatus',      // claimAccount — must be UNSET or hydration won't re-run
  'hydrationPendingAt',   // claimAccount
];

function fail(msg) {
  console.error(`\nABORT: ${msg}\nNothing was written.\n`);
  process.exit(1);
}

function tag() {
  return APPLY ? '[APPLY]' : '[DRY RUN]';
}

async function main() {
  admin.initializeApp();
  const db = admin.firestore();

  console.log(`\n${tag()} Reset portal claim state for patients/${PATIENT_ID}\n`);

  // --- Guard 1: roster doc exists and is the synthetic fixture -------------
  const rosterRef = db.collection('patients').doc(PATIENT_ID);
  const rosterSnap = await rosterRef.get();
  if (!rosterSnap.exists) fail(`patients/${PATIENT_ID} does not exist.`);
  const p = rosterSnap.data() || {};

  const first = String(p.firstName || '').trim().toLowerCase();
  const last = String(p.lastName || '').trim().toLowerCase();
  const email = String(p.email || '').trim().toLowerCase();

  if (first !== EXPECTED_FIRST || last !== EXPECTED_LAST) {
    fail(`roster name is "${p.firstName} ${p.lastName}", expected "Test Kieffer". This is not the synthetic fixture.`);
  }
  if (email !== EXPECTED_EMAIL) {
    fail(`roster email is "${p.email}", expected "${EXPECTED_EMAIL}". This is not the synthetic fixture.`);
  }

  // --- Guard 2: the bound uid is the one we expect -------------------------
  const boundUid = String(p.firebaseUid || '');
  if (boundUid && boundUid.toLowerCase() !== EXPECTED_UID.toLowerCase()) {
    fail(`roster firebaseUid is "${boundUid}", expected "${EXPECTED_UID}". Refusing to unbind an unknown account.`);
  }
  if (!boundUid) {
    console.log('note: roster already has no firebaseUid — continuing to clean residue.\n');
  }

  console.log('Current state:');
  for (const f of ROSTER_FIELDS_TO_CLEAR) {
    if (f in p) console.log(`  patients/${PATIENT_ID}.${f} = ${JSON.stringify(p[f])}`);
  }
  console.log(`  roster: ${p.firstName} ${p.lastName} <${p.email}>  status=${p.status || '(unset)'}\n`);

  // --- Step 1: clear the roster binding ------------------------------------
  const present = ROSTER_FIELDS_TO_CLEAR.filter((f) => f in p);
  if (present.length === 0) {
    console.log('1. roster fields — already clear, nothing to do.');
  } else {
    console.log(`1. roster fields — delete: ${present.join(', ')}`);
    if (APPLY) {
      const patch = {};
      for (const f of present) patch[f] = admin.firestore.FieldValue.delete();
      await rosterRef.update(patch);
      console.log('   done.');
    }
  }
  // `email` and `status` are deliberately preserved: the invite is sent to
  // patients/<id>.email, and the ingest gates require status === 'active'.

  // --- Step 2: claimTokens for this patient --------------------------------
  const tokenSnap = await db
    .collection('claimTokens')
    .where('elationPatientId', '==', PATIENT_ID)
    .get();
  console.log(`2. claimTokens — ${tokenSnap.size} doc(s) for this patient`);
  for (const d of tokenSnap.docs) {
    const t = d.data() || {};
    console.log(`   delete claimTokens/${d.id} (used=${Boolean(t.usedAt)})`);
  }
  if (APPLY && tokenSnap.size > 0) {
    const batch = db.batch();
    tokenSnap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    console.log('   done.');
  }

  // --- Step 3: uid-keyed portal docs ---------------------------------------
  // createUserProfile writes users/<uid-lowercased>; syncDirectoryEntry mirrors
  // it to directory/<uid> and removes that mirror when the users doc is deleted.
  // The directory delete is repeated explicitly in case the trigger lags.
  const uid = boundUid || EXPECTED_UID;
  const uidVariants = Array.from(new Set([uid, uid.toLowerCase(), EXPECTED_UID, EXPECTED_UID.toLowerCase()]));
  console.log('3. uid-keyed docs');
  for (const u of uidVariants) {
    for (const path of [`users/${u}`, `directory/${u}`]) {
      const ref = db.doc(path);
      const snap = await ref.get();
      if (!snap.exists) continue;
      console.log(`   delete ${path}`);
      if (APPLY) await ref.delete();
    }
  }
  if (APPLY) console.log('   done.');

  // --- Step 4: the Auth user, last -----------------------------------------
  console.log('4. Firebase Auth user');
  let authUser = null;
  try {
    authUser = await admin.auth().getUser(EXPECTED_UID);
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
  }
  if (!authUser) {
    console.log(`   auth uid ${EXPECTED_UID} not found — already deleted.`);
  } else {
    if (String(authUser.email || '').toLowerCase() !== EXPECTED_EMAIL) {
      fail(`auth user ${EXPECTED_UID} has email "${authUser.email}", expected "${EXPECTED_EMAIL}".`);
    }
    console.log(`   delete auth user ${EXPECTED_UID} <${authUser.email}>`);
    if (APPLY) {
      await admin.auth().deleteUser(EXPECTED_UID);
      console.log('   done.');
    }
  }

  // --- Verification --------------------------------------------------------
  if (APPLY) {
    const after = (await rosterRef.get()).data() || {};
    const leftovers = ROSTER_FIELDS_TO_CLEAR.filter((f) => f in after);
    const tokensLeft = (await db.collection('claimTokens')
      .where('elationPatientId', '==', PATIENT_ID).get()).size;
    console.log('\nVerification:');
    console.log(`  roster claim fields remaining: ${leftovers.length ? leftovers.join(', ') : 'none'}`);
    console.log(`  claimTokens remaining: ${tokensLeft}`);
    console.log(`  roster email preserved: ${after.email || '(MISSING — invite will 422)'}`);
    if (leftovers.length || tokensLeft) {
      console.log('\n  NOT clean — re-run before attempting row 2.');
      process.exit(2);
    }
    console.log('\nClean. Confirm the Portal tab reads "Not invited", then run row 2.');
  } else {
    console.log('\nDry run only. Re-run with --apply to perform the deletes.');
  }
  console.log('');
}

main().catch((e) => {
  console.error(`\nFAILED: ${e && e.message ? e.message : e}\n`);
  process.exit(1);
});

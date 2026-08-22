// functions/dependentBirthdaySweep.js
// Scheduled daily. Converts minors who have reached 18 into independent
// accounts.
//
// On the 18th birthday:
//   1. dependent.isMinor -> false
//   2. every 'active' guardian entry -> 'pending_adult_consent'
//      (denies exactly like absence; the guardian sees an empty section,
//       never "access was removed")
//   3. the now-adult gets their own portal invite, if they have no live claim
//      token and no claimed account yet
//
// Idempotent: a record already converted is skipped, so a re-run after a
// partial failure is safe.

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { log, logError } = require('./middleware/logger');
const { eighteenthBirthday } = require('./core/services/patient/guardians');

// Reuse the existing invite path so the email template, token TTL, and
// claimTokens shape stay identical to a staff-issued invite.
const { issueClaimToken } = require('./core/services/patient/claimTokens');
const { sendInviteEmail } = require('./core/services/email/sendInviteEmail');

const BATCH_LIMIT = 200;

async function convertOne(doc, now) {
  const db = admin.firestore();
  const data = doc.data() || {};
  const dob = String(data.dob || data.dateOfBirth || (data.dependent && data.dependent.dob) || '').trim();
  const converts = eighteenthBirthday(dob);
  if (!converts || now.getTime() < converts.getTime()) return { skipped: 'not_yet' };

  const guardians = Array.isArray(data.guardians) ? data.guardians.slice() : [];
  let moved = 0;
  for (let i = 0; i < guardians.length; i += 1) {
    if (guardians[i] && guardians[i].status === 'active') {
      guardians[i] = { ...guardians[i], status: 'pending_adult_consent' };
      moved += 1;
    }
  }

  await doc.ref.set(
    {
      guardians,
      dependent: {
        ...(data.dependent || {}),
        isMinor: false,
        dob,
        convertsAt: admin.firestore.Timestamp.fromDate(converts),
        convertedAt: admin.firestore.Timestamp.now(),
      },
    },
    { merge: true },
  );

  let invited = false;
  const alreadyClaimed = Boolean(data.claimedAt || data.firebaseUid);
  if (!alreadyClaimed) {
    try {
      const email = String(data.email || '').trim().toLowerCase();
      if (email) {
        const { rawToken, existing } = await issueClaimToken(doc.id, { reissue: false });
        if (!existing && rawToken) {
          await sendInviteEmail({ to: email, token: rawToken, elationPatientId: doc.id });
          invited = true;
        }
      }
    } catch (e) {
      // A failed invite must not roll back the consent change: the guardian's
      // proxy being paused is the security-relevant half.
      logError('dependentBirthdaySweep', 'invite-failed', { id: doc.id, message: e.message });
    }
  }

  try {
    await db.collection('portalAdminAudit').add({
      at: admin.firestore.Timestamp.now(),
      action: 'dependent_converted',
      elationPatientId: doc.id,
      actor: 'system:dependentBirthdaySweep',
      reason: 'reached age 18',
      guardiansPaused: moved,
      invited,
      ok: true,
    });
  } catch (e) {
    logError('dependentBirthdaySweep', 'audit-write-failed', { message: e.message });
  }

  return { converted: true, guardiansPaused: moved, invited };
}

async function runSweep(now = new Date()) {
  const db = admin.firestore();
  const snap = await db
    .collection('patients')
    .where('dependent.isMinor', '==', true)
    .where('dependent.convertsAt', '<=', admin.firestore.Timestamp.fromDate(now))
    .limit(BATCH_LIMIT)
    .get();

  let converted = 0;
  let paused = 0;
  let invited = 0;
  for (const doc of snap.docs) {
    try {
      const r = await convertOne(doc, now);
      if (r.converted) {
        converted += 1;
        paused += r.guardiansPaused;
        if (r.invited) invited += 1;
      }
    } catch (e) {
      logError('dependentBirthdaySweep', 'convert-failed', { id: doc.id, message: e.message });
    }
  }

  log('dependentBirthdaySweep', 'done', {
    scanned: snap.size,
    converted,
    guardiansPaused: paused,
    invited,
    truncated: snap.size === BATCH_LIMIT,
  });
  return { scanned: snap.size, converted, guardiansPaused: paused, invited };
}

exports.dependentBirthdaySweep = functions
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .pubsub.schedule('15 7 * * *')
  .timeZone('America/New_York')
  .onRun(async () => {
    await runSweep(new Date());
    return null;
  });

exports.runSweep = runSweep;

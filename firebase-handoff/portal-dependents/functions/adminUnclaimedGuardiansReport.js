// functions/adminUnclaimedGuardiansReport.js
// Admin plane, READ-ONLY. Rollout artifact for Release 2b phase 1.
//
// Phase 1 authorizes a guardian off their CHART (the entry's guardianElationId
// equals the caller's own record id). That only works for a guardian who has a
// portal account of their own. This report lists the links where that is NOT
// yet true, so staff can send those parents the normal self-invite:
//
//   - guardian entries with no `guardianUid` AND whose `guardianElationId`
//     record has no `firebaseUid` (never claimed a portal account), and
//   - `email_on_file` entries (guardianElationId === null) — not authorizable
//     at all in phase 1; they wait for phase 2.
//
// GET or POST. No writes, no PHI beyond ids/emails already in the admin plane.

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { log, logError } = require('./middleware/logger');
const { requireAdminCaller, selfAudience } = require('./middleware/requireAdminCaller');

function jsonError(res, status, code, reason, message) {
  return res.status(status).json({
    error: { code: status, status: code, message: message || reason, details: { reason } },
  });
}

async function guardianHasAccount(cache, guardianElationId) {
  const id = String(guardianElationId || '').trim();
  if (!id) return false;
  if (Object.prototype.hasOwnProperty.call(cache, id)) return cache[id];
  let has = false;
  try {
    const snap = await admin.firestore().collection('patients').doc(id).get();
    has = Boolean(snap.exists && snap.get('firebaseUid'));
  } catch (_e) {
    has = false; // fail closed: report it as unclaimed so staff look at it
  }
  cache[id] = has;
  return has;
}

exports.adminUnclaimedGuardiansReport = functions
  .runWith({ timeoutSeconds: 300 })
  .https.onRequest(async (req, res) => {
    res.set('Cache-Control', 'no-store');

    if (req.method !== 'GET' && req.method !== 'POST') {
      res.set('Allow', 'GET, POST');
      return jsonError(res, 405, 'FAILED_PRECONDITION', 'METHOD_NOT_ALLOWED');
    }

    const gate = await requireAdminCaller(
      req,
      selfAudience(req, 'adminUnclaimedGuardiansReport'),
    );
    if (!gate.ok) {
      log('adminUnclaimedGuardiansReport', 'caller-rejected', { reason: gate.reason });
      return jsonError(res, gate.status, 'PERMISSION_DENIED', gate.reason);
    }

    try {
      const snap = await admin.firestore()
        .collection('patients')
        .where('dependent.isMinor', '==', true)
        .get();

      const cache = {};
      const rows = [];
      let totalLinks = 0;
      let claimed = 0;

      for (const docSnap of snap.docs) {
        const guardians = docSnap.get('guardians');
        if (!Array.isArray(guardians)) continue;
        for (const g of guardians) {
          if (!g || g.status !== 'active') continue;
          totalLinks += 1;
          const guardianElationId = g.guardianElationId ? String(g.guardianElationId) : null;
          // eslint-disable-next-line no-await-in-loop
          const hasAccount = guardianElationId
            ? await guardianHasAccount(cache, guardianElationId)
            : false;
          if (g.guardianUid || hasAccount) {
            claimed += 1;
            continue;
          }
          rows.push({
            childElationId: docSnap.id,
            guardianElationId,
            guardianEmail: g.guardianEmail || null,
            guardianName: g.guardianName || null,
            source: g.source || null,
            // Why it can't be authorized yet — drives the staff action.
            blocker: guardianElationId ? 'GUARDIAN_HAS_NO_PORTAL_ACCOUNT' : 'EMAIL_ONLY_PHASE_2',
          });
        }
      }

      log('adminUnclaimedGuardiansReport', 'complete', {
        minors: snap.size, totalLinks, claimed, unclaimed: rows.length,
      });

      return res.status(200).json({
        generatedAt: new Date().toISOString(),
        summary: { minors: snap.size, activeLinks: totalLinks, claimed, unclaimed: rows.length },
        rows,
      });
    } catch (err) {
      logError('adminUnclaimedGuardiansReport', 'failed', err, {});
      return jsonError(res, 500, 'INTERNAL', 'REPORT_FAILED', 'Could not build the report.');
    }
  });

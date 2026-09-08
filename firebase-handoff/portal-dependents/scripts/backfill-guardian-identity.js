#!/usr/bin/env node
/**
 * backfill-guardian-identity.js  (one-time, pre-cutover)
 *
 * WHY
 * ---
 * Authorization for a guardian read is, today, exclusively:
 *   - guardians[].guardianUid  === caller uid                (fast path), or
 *   - guardians[].guardianElationId === caller's OWN record  (chart path)
 * (see functions/core/services/patient/guardians.js :: resolveGuardianAccess,
 *  and getMyDependents' looksLikeMine, which mirrors it).
 *
 * There is NO email path anywhere on the read side, and nothing binds
 * guardianUid at claim time. So an `email_on_file` entry — guardianElationId
 * null, guardianUid null — is unauthorizable: the child never appears in the
 * switcher and the read denies.
 *
 * WHAT THIS DOES
 * --------------
 * READ-ONLY by default. For every active guardian entry on a minor:
 *   1. Resolve the guardian's own Elation chart by email
 *      (patients where lower(email) == guardianEmail), and
 *   2. Resolve the guardian's Firebase Auth uid by email.
 * Writes ONLY the two identity fields on that one entry:
 *      guardianElationId (if resolved and currently null)
 *      guardianUid       (if resolved and currently null)
 * Nothing else on the child doc is touched: status, source, confirmedBy,
 * dependent{}, artifacts — all untouched.
 *
 * SAFETY RULES (all fail-closed; ambiguity is reported, never guessed)
 *   - AMBIGUOUS_CHART   : email matches >1 patient chart      -> skip
 *   - SELF_LINK         : resolved chart id == child id       -> skip
 *   - CHART_IS_MINOR    : resolved chart is itself a minor    -> skip
 *   - UID_CONFLICT      : entry already bound to another uid  -> skip
 *   - NO_AUTH_USER      : guardian has no Auth account yet    -> chart-only fill
 *   - NO_MATCH          : neither chart nor uid resolvable    -> report row
 *
 * A guardian with no chart AND no Auth account cannot be made readable by any
 * backfill — those parents need the normal self-invite first. This script
 * emits them as `needsInvite` so staff can act on a concrete list.
 *
 * USAGE
 *   node backfill-guardian-identity.js                 # dry run, full report
 *   node backfill-guardian-identity.js --apply         # write
 *   node backfill-guardian-identity.js --child <id>    # single child
 *   node backfill-guardian-identity.js --out report.json
 *
 * Requires ADC with Firestore + Firebase Auth read (and write for --apply):
 *   gcloud auth application-default login
 *   export GOOGLE_CLOUD_PROJECT=prive-care-vip
 */

const admin = require('firebase-admin');
const fs = require('fs');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ONE_CHILD = (() => {
  const i = args.indexOf('--child');
  return i >= 0 ? String(args[i + 1] || '').trim() : null;
})();
const OUT = (() => {
  const i = args.indexOf('--out');
  return i >= 0 ? String(args[i + 1] || '').trim() : null;
})();

admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT || 'prive-care-vip' });
const db = admin.firestore();
const auth = admin.auth();

const lower = (v) => String(v || '').trim().toLowerCase();

const chartCache = new Map(); // email -> { id, reason } | null
const uidCache = new Map(); // email -> uid | null

async function resolveChartByEmail(email) {
  if (chartCache.has(email)) return chartCache.get(email);
  let out = { id: null, reason: 'NO_MATCH' };
  try {
    // Roster docs store email in `email`; some carry `emailLower`.
    const snaps = await Promise.all([
      db.collection('patients').where('emailLower', '==', email).limit(5).get(),
      db.collection('patients').where('email', '==', email).limit(5).get(),
    ]);
    const ids = new Set();
    for (const s of snaps) for (const d of s.docs) ids.add(d.id);
    const list = [...ids];
    if (list.length === 1) out = { id: list[0], reason: 'CHART_MATCH' };
    else if (list.length > 1) out = { id: null, reason: 'AMBIGUOUS_CHART', candidates: list };
  } catch (e) {
    out = { id: null, reason: `CHART_LOOKUP_FAILED:${e.code || e.message}` };
  }
  chartCache.set(email, out);
  return out;
}

async function resolveUidByEmail(email) {
  if (uidCache.has(email)) return uidCache.get(email);
  let uid = null;
  try {
    const u = await auth.getUserByEmail(email);
    uid = String(u.uid || '').toLowerCase() || null;
  } catch (_e) {
    uid = null; // auth/user-not-found and anything else -> treat as no account
  }
  uidCache.set(email, uid);
  return uid;
}

async function isMinorDoc(id) {
  try {
    const s = await db.collection('patients').doc(id).get();
    return Boolean(s.exists && s.get('dependent.isMinor'));
  } catch (_e) {
    return false;
  }
}

async function main() {
  let docs;
  if (ONE_CHILD) {
    const s = await db.collection('patients').doc(ONE_CHILD).get();
    docs = s.exists ? [s] : [];
  } else {
    const s = await db.collection('patients').where('dependent.isMinor', '==', true).get();
    docs = s.docs;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    apply: APPLY,
    minors: docs.length,
    counts: {
      activeLinks: 0,
      alreadyAuthorizable: 0,
      filledChartAndUid: 0,
      filledChartOnly: 0,
      filledUidOnly: 0,
      needsInvite: 0,
      skipped: 0,
    },
    changes: [],
    needsInvite: [],
    skipped: [],
  };

  for (const docSnap of docs) {
    const childId = docSnap.id;
    const guardians = docSnap.get('guardians');
    if (!Array.isArray(guardians) || guardians.length === 0) continue;

    const next = guardians.slice();
    let dirty = false;

    for (let i = 0; i < next.length; i += 1) {
      const g = next[i];
      if (!g || g.status !== 'active') continue;
      report.counts.activeLinks += 1;

      const email = lower(g.guardianEmail);
      const hasUid = Boolean(g.guardianUid);
      const hasChart = Boolean(g.guardianElationId);
      if (hasUid && hasChart) {
        report.counts.alreadyAuthorizable += 1;
        continue;
      }

      if (!email) {
        report.counts.skipped += 1;
        report.skipped.push({ childId, index: i, reason: 'NO_EMAIL' });
        continue;
      }

      /* eslint-disable no-await-in-loop */
      const chart = hasChart ? { id: String(g.guardianElationId), reason: 'PREEXISTING' }
        : await resolveChartByEmail(email);
      const uid = hasUid ? lower(g.guardianUid) : await resolveUidByEmail(email);

      if (chart.id && chart.id === String(childId)) {
        report.counts.skipped += 1;
        report.skipped.push({ childId, index: i, email, reason: 'SELF_LINK', chartId: chart.id });
        continue;
      }
      if (chart.id && !hasChart && (await isMinorDoc(chart.id))) {
        report.counts.skipped += 1;
        report.skipped.push({ childId, index: i, email, reason: 'CHART_IS_MINOR', chartId: chart.id });
        continue;
      }
      if (chart.reason === 'AMBIGUOUS_CHART') {
        report.counts.skipped += 1;
        report.skipped.push({ childId, index: i, email, reason: 'AMBIGUOUS_CHART', candidates: chart.candidates });
        continue;
      }
      if (hasUid && uid && lower(g.guardianUid) !== uid) {
        report.counts.skipped += 1;
        report.skipped.push({ childId, index: i, email, reason: 'UID_CONFLICT' });
        continue;
      }
      /* eslint-enable no-await-in-loop */

      const setChart = !hasChart && Boolean(chart.id);
      const setUid = !hasUid && Boolean(uid);

      if (!setChart && !setUid) {
        // Nothing resolvable: unreadable until the parent claims an account.
        report.counts.needsInvite += 1;
        report.needsInvite.push({
          childId, index: i, email, source: g.source || null,
          blocker: 'NO_CHART_NO_AUTH_ACCOUNT',
        });
        continue;
      }

      next[i] = {
        ...g,
        ...(setChart ? { guardianElationId: chart.id } : {}),
        ...(setUid ? { guardianUid: uid } : {}),
      };
      dirty = true;

      if (setChart && setUid) report.counts.filledChartAndUid += 1;
      else if (setChart) report.counts.filledChartOnly += 1;
      else report.counts.filledUidOnly += 1;

      report.changes.push({
        childId,
        index: i,
        email,
        source: g.source || null,
        set: {
          ...(setChart ? { guardianElationId: chart.id } : {}),
          ...(setUid ? { guardianUid: uid } : {}),
        },
      });
    }

    if (dirty && APPLY) {
      // Only the guardians array is written; merge keeps everything else intact.
      // eslint-disable-next-line no-await-in-loop
      await db.collection('patients').doc(childId).set(
        {
          guardians: next,
          guardiansUpdatedAt: admin.firestore.Timestamp.now(),
          guardiansUpdatedBy: 'backfill-guardian-identity',
        },
        { merge: true },
      );
      // eslint-disable-next-line no-await-in-loop
      await db.collection('portalAdminAudit').add({
        at: admin.firestore.Timestamp.now(),
        action: 'guardian_identity_backfilled',
        elationPatientId: childId,
        actor: 'backfill-guardian-identity',
        reason: 'R2b cutover: resolve email_on_file guardians to chart/uid',
        ok: true,
      });
    }
  }

  const json = JSON.stringify(report, null, 2);
  if (OUT) fs.writeFileSync(OUT, json);
  process.stdout.write(`${json}\n`);
  process.stdout.write(
    APPLY ? '\nAPPLIED.\n' : '\nDRY RUN — no writes. Re-run with --apply to write.\n',
  );
}

main().catch((e) => {
  process.stderr.write(`FAILED: ${e.stack || e.message}\n`);
  process.exit(1);
});

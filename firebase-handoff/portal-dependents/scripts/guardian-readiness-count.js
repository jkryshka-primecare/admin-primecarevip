#!/usr/bin/env node
/**
 * guardian-readiness-count.js — READ ONLY. Never writes.
 *
 * Answers: how many minors are actually readable by a guardian at cutover?
 *
 * A guardian link is READY only when the guardian can pass the read check AND
 * getMyDependents can build the switcher, i.e. the guardian has:
 *   - a claimed portal (Auth) account  -> guardianUid resolvable, and
 *   - their OWN patient chart          -> guardianElationId that exists,
 *                                         is not the child, and is claimed.
 *
 * Buckets per minor (best guardian wins):
 *   READY_BOUND        guardian entry already carries uid + chart
 *   READY_RESOLVABLE   uid and chart resolvable by email now (backfill fixes it)
 *   CHART_NO_ACCOUNT   parent has a chart but never claimed -> invite campaign
 *   ACCOUNT_NO_CHART   parent has Auth but no chart -> blocked by no-self-record
 *   NO_CHART_NO_ACCOUNT parent never onboarded -> onboard + invite
 *
 * Usage:
 *   npm i firebase-admin
 *   export GOOGLE_CLOUD_PROJECT=prive-care-vip
 *   node guardian-readiness-count.js [--out readiness.json]
 */

const admin = require('firebase-admin');
const fs = require('fs');

const args = process.argv.slice(2);
const OUT = (() => { const i = args.indexOf('--out'); return i >= 0 ? args[i + 1] : null; })();

admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT || 'prive-care-vip' });
const db = admin.firestore();
const auth = admin.auth();

const lower = (v) => String(v || '').trim().toLowerCase();
const chartCache = new Map();
const uidCache = new Map();

function isMinorSnap(d) {
  if (d.get('dependent.isMinor') === true) return true;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d.get('dob') || d.get('dateOfBirth') || '').trim());
  if (!m) return false;
  return Date.now() < Date.UTC(Number(m[1]) + 18, Number(m[2]) - 1, Number(m[3]));
}

async function adultsForEmail(email) {
  if (chartCache.has(email)) return chartCache.get(email);
  const snaps = await Promise.all([
    db.collection('patients').where('emailLower', '==', email).limit(25).get(),
    db.collection('patients').where('email', '==', email).limit(25).get(),
  ]);
  const seen = new Map();
  for (const s of snaps) {
    for (const d of s.docs) {
      if (!seen.has(d.id)) {
        seen.set(d.id, {
          id: d.id,
          isMinor: isMinorSnap(d),
          claimed: Boolean(d.get('firebaseUid') || d.get('authUid') || d.get('claimedAt')),
        });
      }
    }
  }
  const list = [...seen.values()];
  chartCache.set(email, list);
  return list;
}

async function uidForEmail(email) {
  if (uidCache.has(email)) return uidCache.get(email);
  let uid = null;
  try { uid = lower((await auth.getUserByEmail(email)).uid) || null; } catch (_) { uid = null; }
  uidCache.set(email, uid);
  return uid;
}

const RANK = ['NO_CHART_NO_ACCOUNT', 'ACCOUNT_NO_CHART', 'CHART_NO_ACCOUNT', 'READY_RESOLVABLE', 'READY_BOUND'];

async function classifyEntry(childId, g) {
  const email = lower(g.guardianEmail);
  const hasChart = Boolean(g.guardianElationId) && String(g.guardianElationId) !== String(childId);
  const hasUid = Boolean(g.guardianUid);
  if (hasChart && hasUid) return 'READY_BOUND';

  const uid = hasUid ? lower(g.guardianUid) : (email ? await uidForEmail(email) : null);
  let chart = hasChart ? { id: String(g.guardianElationId), claimed: null } : null;
  if (!chart && email) {
    const adults = (await adultsForEmail(email)).filter((c) => c.id !== String(childId) && !c.isMinor);
    if (adults.length === 1) chart = adults[0];
  }
  if (chart && uid) return 'READY_RESOLVABLE';
  if (chart && !uid) return 'CHART_NO_ACCOUNT';
  if (!chart && uid) return 'ACCOUNT_NO_CHART';
  return 'NO_CHART_NO_ACCOUNT';
}

async function main() {
  const snap = await db.collection('patients').where('dependent.isMinor', '==', true).get();
  const perMinor = {};
  const counts = { minors: 0, minorsWithActiveLink: 0, activeLinks: 0 };
  for (const b of RANK) counts[b] = 0;

  for (const d of snap.docs) {
    counts.minors += 1;
    const guardians = (d.get('guardians') || []).filter((g) => g && g.status === 'active');
    if (!guardians.length) continue;
    counts.minorsWithActiveLink += 1;
    counts.activeLinks += guardians.length;

    let best = 'NO_CHART_NO_ACCOUNT';
    for (const g of guardians) {
      // eslint-disable-next-line no-await-in-loop
      const c = await classifyEntry(d.id, g);
      if (RANK.indexOf(c) > RANK.indexOf(best)) best = c;
    }
    counts[best] += 1;
    perMinor[d.id] = best;
  }

  const readyAtCutover = counts.READY_BOUND + counts.READY_RESOLVABLE;
  const report = { generatedAt: new Date().toISOString(), counts, readyAtCutover, perMinor };
  const json = JSON.stringify(report, null, 2);
  if (OUT) fs.writeFileSync(OUT, json);
  process.stdout.write(`${json}\nREAD ONLY — nothing was written to Firestore.\n`);
}

main().catch((e) => { process.stderr.write(`FAILED: ${e.stack || e.message}\n`); process.exit(1); });

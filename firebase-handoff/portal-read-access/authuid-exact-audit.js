#!/usr/bin/env node
'use strict';
// B4 / #593 production exact-case authUid audit. READ-ONLY.
// Calls: Hint GET /patients, Firestore .get(), Auth listUsers. No writes, no sends.
// Joins Hint -> portal record by Elation id (integration_record_id) or hint id field. Never by email.
const admin = require('firebase-admin');
const fs = require('fs');

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(sa), projectId: 'prive-care-vip' });
const db = admin.firestore();
const auth = admin.auth();
const lower = (v) => String(v || '').toLowerCase();

async function hintActive() {
  const out = []; let offset = 0;
  for (;;) {
    const r = await fetch(`https://api.hint.com/api/provider/patients?limit=100&offset=${offset}`, {
      headers: { Authorization: `Bearer ${process.env.HINT_PRACTICE_API_KEY}` } });
    if (!r.ok) throw new Error(`hint ${r.status}`);
    const page = await r.json();
    for (const p of page) if (p.membership_status === 'active') out.push({ hintId: p.id, elationId: p.integration_record_id ? String(p.integration_record_id) : null });
    if (page.length < 100) break; offset += 100;
  }
  return out;
}

(async () => {
  const active = await hintActive();
  const octMap = new Map();
  for (const line of fs.readFileSync('/mnt/documents/Social_SignIn_DryRun_2026-10-29_by_member_ID.csv','utf8').split('\n').slice(1)) {
    const [h, e] = line.split(','); if (h && e) octMap.set(h, e);
  }
  const snap = await db.collection('patients').get();
  const byId = new Map(); const byHint = new Map(); const fuidCount = new Map();
  snap.forEach((d) => {
    const x = d.data(); byId.set(d.id, x);
    for (const k of ['hintPatientId', 'hintId', 'hint_patient_id']) if (x[k]) byHint.set(String(x[k]), d.id);
    if (x.firebaseUid) fuidCount.set(x.firebaseUid, (fuidCount.get(x.firebaseUid) || 0) + 1);
  });
  // Exact-uid lookups (accounts:lookup is case-sensitive). Also look up the lower-case
  // variant to detect case drift. listUsers is not granted to the read-only account.
  const want = new Set();
  for (const x of byId.values()) { if (x.authUid) { want.add(String(x.authUid)); want.add(lower(x.authUid)); } if (x.firebaseUid) want.add(String(x.firebaseUid)); }
  const ids = [...want]; const users = new Map();
  let authReadable = true;
  try {
    for (let i = 0; i < ids.length; i += 100) {
      const r = await auth.getUsers(ids.slice(i, i + 100).map((uid) => ({ uid })));
      for (const u of r.users) users.set(u.uid, u);
    }
  } catch (e) { if (e.code !== 'auth/insufficient-permission') throw e; authReadable = false; }
  const usersLc = new Map();
  for (const u of users.values()) { const l = lower(u.uid); usersLc.set(l, (usersLc.get(l) || []).concat(u.uid)); }
  function classify(d){
    let bucket; const fails = [];
    if (!d) bucket = 'NO_PORTAL_RECORD';
    else if (!d.authUid && !d.firebaseUid) bucket = 'NO_LOGIN_BINDING';
    else {
      const a = d.authUid ? String(d.authUid) : null; const f = d.firebaseUid ? String(d.firebaseUid) : null;
      if (!a) fails.push('AUTHUID_MISSING');
      else if (!authReadable) fails.push('AUTH_UNREADABLE');
      else {
        const u = users.get(a);
        if (!u) fails.push((usersLc.get(lower(a)) || []).length ? 'AUTHUID_CASE_DRIFT_LIVE_USER_DIFFERENT_CASE' : 'AUTHUID_NOT_LIVE');
        else if (u.disabled) fails.push('AUTH_USER_DISABLED');
        if ((usersLc.get(lower(a)) || []).length > 1) fails.push('MULTIPLE_AUTH_USERS_SAME_LOWERCASE');
      }
      if (!f) fails.push('FIREBASEUID_MISSING');
      else if (a && lower(a) !== f) fails.push('FIREBASEUID_NE_LOWER_AUTHUID');
      if (f && fuidCount.get(f) > 1) fails.push('DUPLICATE_FIREBASEUID_BINDING');
      const hard = fails.filter((x) => x !== 'AUTH_UNREADABLE');
      bucket = hard.length ? 'DOES_NOT_RESOLVE' : fails.length ? 'FIRESTORE_OK_AUTH_UNVERIFIED' : 'RESOLVES_EXACT';
    }
    return { bucket, fails };
  }
  const rows = []; const c = {};
  const inc = (k) => { c[k] = (c[k] || 0) + 1; };
  for (const m of active) {
    const cand = m.elationId || byHint.get(m.hintId) || octMap.get(m.hintId) || null;
    const eid = cand && byId.has(cand) ? cand : null;
    const d = eid ? byId.get(eid) : null;
    const { bucket, fails } = classify(d);
    inc(bucket); for (const x of fails) inc(`fail:${x}`);
    rows.push([m.hintId, eid || '', bucket, fails.join('|')]);
  }
  const all = {}; const activeIds = new Set(rows.map((r) => r[1]).filter(Boolean));
  const allRows = [];
  for (const [id, d] of byId) {
    if (!d.authUid && !d.firebaseUid) continue;
    const { bucket, fails } = classify(d);
    all[bucket] = (all[bucket] || 0) + 1; for (const x of fails) all[`fail:${x}`] = (all[`fail:${x}`] || 0) + 1;
    allRows.push([id, activeIds.has(id) ? 'active_hint' : 'not_matched_active', bucket, fails.join('|')]);
  }
  fs.writeFileSync(process.argv[3], ['elation_patient_id,hint_status,bucket,fails', ...allRows.map((r) => r.join(','))].join('\n') + '\n');
  const csv = ['hint_patient_id,elation_patient_id,bucket,fails', ...rows.map((r) => r.join(','))].join('\n') + '\n';
  fs.writeFileSync(process.argv[2], csv);
  console.log(JSON.stringify({ activeHintMembers: active.length, portalRecords: snap.size, authReadable, authUsersFound: users.size, activeCounts: c, allLoginBoundRecords: allRows.length, allLoginBoundCounts: all }, null, 2));
})().catch((e) => { console.error('FAILED', e.code || '', e.message); process.exit(1); });

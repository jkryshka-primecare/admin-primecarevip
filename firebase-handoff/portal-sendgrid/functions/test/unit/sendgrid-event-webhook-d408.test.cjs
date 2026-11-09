// #362 / D-408 — SendGrid Event Webhook receiver + emailEvents + suppression.
//   node functions/test/unit/sendgrid-event-webhook-d408.test.cjs

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const Module = require('module');

const fnDir = path.join(__dirname, '..', '..');

// ---- stub firebase-admin / functions / secret-manager --------------------
const TS = { now: () => ({ __ts: true }) };
const adminStub = { firestore: () => ({}) };
adminStub.firestore.Timestamp = TS;
adminStub.firestore.FieldValue = { serverTimestamp: () => ({ __sv: true }) };

const origLoad = Module._load;
Module._load = function (request) {
  if (request === 'firebase-admin') return adminStub;
  if (request === 'firebase-functions') {
    const https = { onRequest: () => ({}), onCall: () => ({}) };
    const runWith = () => ({ https });
    return { params: { defineSecret: () => ({ value: () => 'x' }) }, runWith, https, region: () => ({ runWith, https }), config: () => ({}) };
  }
  if (request === 'firebase-functions/v2/scheduler') return { onSchedule: () => ({}) };
  if (request === '@google-cloud/secret-manager') {
    return { SecretManagerServiceClient: class { async accessSecretVersion() { throw new Error('no secret manager in tests'); } } };
  }
  return origLoad.apply(this, arguments);
};

const sg = require(path.join(fnDir, 'core/services/email/sendgridEvents.js'));
const { handleEventWebhook, EVENTS_COLLECTION, SUPPRESSION_COLLECTION, getVerificationKey, SECRET_NAME } = require(path.join(fnDir, 'sendgridEventWebhook.js'));
// The D-407 autosender reads suppression through this SHARED module; driving
// the same reader over rows this receiver wrote is the alignment proof.
const { loadSuppressedEmails } = require(path.join(fnDir, 'core/services/email/suppression.js'));

let failures = 0;
function t(name, fn) {
  const done = (e) => {
    if (e) { failures += 1; console.log(`FAIL  ${name}\n      ${e.message}`); }
    else console.log(`  ok  ${name}`);
  };
  try {
    const r = fn();
    if (r && typeof r.then === 'function') return r.then(() => done(), done);
    done();
  } catch (e) { done(e); }
}

// ---- a real ECDSA P-256 key pair, exactly like SendGrid's ----------------
const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const PUBLIC_B64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

function sign(timestamp, rawBody, key = privateKey) {
  const s = crypto.createSign('sha256');
  s.update(Buffer.from(String(timestamp), 'utf8'));
  s.update(rawBody);
  s.end();
  return s.sign(key).toString('base64');
}

const NOW = 1_764_000_000_000; // fixed clock
const TS_SECONDS = String(Math.floor(NOW / 1000));

function makeReq(events, { signature, timestamp = TS_SECONDS, method = 'POST', rawOverride } = {}) {
  const rawBody = rawOverride !== undefined ? rawOverride : Buffer.from(JSON.stringify(events), 'utf8');
  const headers = {};
  const sigValue = signature === undefined ? sign(timestamp, rawBody) : signature;
  if (sigValue !== null) headers[sg.SIGNATURE_HEADER] = sigValue;
  if (timestamp !== null) headers[sg.TIMESTAMP_HEADER] = timestamp;
  return { method, headers, rawBody };
}

function makeRes() {
  const out = { statusCode: null, body: null };
  out.status = (c) => { out.statusCode = c; return out; };
  out.json = (b) => { out.body = b; return out; };
  out.headersSent = false;
  return out;
}

// ---- minimal in-memory Firestore ----------------------------------------
function fakeDb() {
  const data = new Map(); // "col/id" -> object
  const key = (c, i) => `${c}/${i}`;
  const docRef = (c, i) => ({
    __c: c,
    __i: i,
    async create(v) {
      if (data.has(key(c, i))) { const e = new Error('already exists'); e.code = 6; throw e; }
      data.set(key(c, i), { ...v });
    },
    async set(v, opts) {
      const prev = (opts && opts.merge && data.get(key(c, i))) || {};
      data.set(key(c, i), { ...prev, ...v });
    },
    async get() {
      const v = data.get(key(c, i));
      return { exists: !!v, id: i, data: () => v };
    },
  });
  return {
    __data: data,
    collection(c) {
      return {
        doc: (i) => docRef(c, i),
        select() { return this; },
        async get() {
          const docs = [];
          for (const [k, v] of data.entries()) {
            if (k.startsWith(`${c}/`)) docs.push({ id: k.slice(c.length + 1), data: () => v });
          }
          return { size: docs.length, docs, forEach: (f) => docs.forEach(f) };
        },
      };
    },
    async runTransaction(fn) {
      const pending = [];
      const result = await fn({
        get: (ref) => ref.get(),
        set: (ref, v, opts) => { pending.push(() => ref.set(v, opts)); },
        create: (ref, v) => { pending.push(() => ref.create(v)); },
      });
      const before = new Map(data);
      try { for (const write of pending) await write(); }
      catch (e) { data.clear(); for (const [k, v] of before) data.set(k, v); throw e; }
      return result;
    },
  };
}

const bounceEvt = (over = {}) => ({
  email: 'Bouncy@Example.com',
  timestamp: Math.floor(NOW / 1000),
  'smtp-id': '<14c5d75ce93.dfd.64b469@ismtpd-555>',
  bounce_classification: 'Invalid Address',
  event: 'bounce',
  category: 'invite',
  sg_event_id: 'a+b/c==',
  sg_message_id: '14c5.filter0001',
  reason: '550 unknown recipient',
  status: '5.0.0',
  type: 'bounce',
  ...over,
});

const deliveredEvt = (over = {}) => ({
  email: 'happy@example.com',
  timestamp: Math.floor(NOW / 1000),
  event: 'delivered',
  sg_event_id: 'deliv-1',
  sg_message_id: '14c5.filter0002',
  response: '250 OK',
  ...over,
});

async function post(db, events, opts) {
  const res = makeRes();
  const stats = await handleEventWebhook({ db, req: makeReq(events, opts), res, publicKey: PUBLIC_B64, nowMs: NOW });
  return { res, stats };
}

(async () => {
  await t('portal signing-key name matches the existing Secret Manager secret', () => {
    assert.strictEqual(SECRET_NAME, 'SENDGRID_WEBHOOK_SIGNING_KEY');
  });
  await t('unavailable Secret Manager key never falls back to unsigned access', async () => {
    await assert.rejects(getVerificationKey(), /no secret manager in tests/);
  });
  // ---------- signature verification ----------
  await t('valid signature verifies', () => {
    const raw = Buffer.from('[{"a":1}]');
    assert.deepStrictEqual(
      sg.verifyEventSignature({ publicKey: PUBLIC_B64, signature: sign(TS_SECONDS, raw), timestamp: TS_SECONDS, rawBody: raw, nowMs: NOW }),
      { ok: true },
    );
  });

  await t('tampered body fails verification', () => {
    const raw = Buffer.from('[{"a":1}]');
    const sig = sign(TS_SECONDS, raw);
    const r = sg.verifyEventSignature({ publicKey: PUBLIC_B64, signature: sig, timestamp: TS_SECONDS, rawBody: Buffer.from('[{"a":2}]'), nowMs: NOW });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'BAD_SIGNATURE');
  });

  await t('signature from a different key fails', () => {
    const other = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
    const raw = Buffer.from('[]');
    const r = sg.verifyEventSignature({ publicKey: PUBLIC_B64, signature: sign(TS_SECONDS, raw, other), timestamp: TS_SECONDS, rawBody: raw, nowMs: NOW });
    assert.strictEqual(r.reason, 'BAD_SIGNATURE');
  });

  await t('timestamp is part of the digest (replayed timestamp fails)', () => {
    const raw = Buffer.from('[]');
    const sig = sign(TS_SECONDS, raw);
    const skewed = String(Number(TS_SECONDS) - 60);
    const r = sg.verifyEventSignature({ publicKey: PUBLIC_B64, signature: sig, timestamp: skewed, rawBody: raw, nowMs: NOW });
    assert.strictEqual(r.reason, 'BAD_SIGNATURE');
  });

  await t('stale timestamp rejected before crypto', () => {
    const old = String(Math.floor(NOW / 1000) - 3600);
    const raw = Buffer.from('[]');
    const r = sg.verifyEventSignature({ publicKey: PUBLIC_B64, signature: sign(old, raw), timestamp: old, rawBody: raw, nowMs: NOW });
    assert.strictEqual(r.reason, 'TIMESTAMP_OUT_OF_WINDOW');
  });

  await t('fails closed with no key / no signature / no timestamp / no body', () => {
    const raw = Buffer.from('[]');
    assert.strictEqual(sg.verifyEventSignature({ publicKey: '', signature: 'x', timestamp: TS_SECONDS, rawBody: raw }).reason, 'NO_VERIFICATION_KEY');
    assert.strictEqual(sg.verifyEventSignature({ publicKey: PUBLIC_B64, signature: '', timestamp: TS_SECONDS, rawBody: raw }).reason, 'MISSING_SIGNATURE');
    assert.strictEqual(sg.verifyEventSignature({ publicKey: PUBLIC_B64, signature: 'x', timestamp: '', rawBody: raw }).reason, 'MISSING_TIMESTAMP');
    assert.strictEqual(sg.verifyEventSignature({ publicKey: PUBLIC_B64, signature: 'x', timestamp: TS_SECONDS, rawBody: undefined }).reason, 'MISSING_RAW_BODY');
  });

  await t('garbage verification key is rejected, not thrown', () => {
    const r = sg.verifyEventSignature({ publicKey: 'not-a-key', signature: 'x', timestamp: TS_SECONDS, rawBody: Buffer.from('[]'), nowMs: NOW });
    assert.strictEqual(r.ok, false);
    assert.ok(['BAD_VERIFICATION_KEY', 'BAD_SIGNATURE'].includes(r.reason));
  });

  // ---------- classification ----------
  await t('hard bounce -> suppression', () => {
    const c = sg.classifyEvent(bounceEvt());
    assert.strictEqual(c.suppression.reason, 'hard_bounce');
    assert.strictEqual(c.suppression.severity, 'hard');
    assert.strictEqual(c.funnel, false);
    assert.strictEqual(c.email, 'bouncy@example.com'); // normalized
  });

  await t('blocked bounce -> suppression, marked soft', () => {
    const c = sg.classifyEvent(bounceEvt({ type: 'blocked' }));
    assert.strictEqual(c.suppression.reason, 'blocked');
    assert.strictEqual(c.suppression.severity, 'soft');
  });

  await t('dropped / spamreport / unsubscribe / group_unsubscribe -> suppression', () => {
    const map = {
      dropped: 'dropped',
      spamreport: 'spam_complaint',
      unsubscribe: 'unsubscribe',
      group_unsubscribe: 'unsubscribe',
    };
    for (const [event, reason] of Object.entries(map)) {
      const c = sg.classifyEvent(bounceEvt({ event, type: undefined, sg_event_id: `e-${event}` }));
      assert.ok(c.suppression, `${event} must suppress`);
      assert.strictEqual(c.suppression.reason, reason);
    }
  });

  await t('delivered / open / click / processed / deferred -> funnel only', () => {
    for (const event of ['delivered', 'open', 'click', 'processed', 'deferred']) {
      const c = sg.classifyEvent(deliveredEvt({ event, sg_event_id: `f-${event}` }));
      assert.strictEqual(c.suppression, null, `${event} must not suppress`);
      assert.strictEqual(c.funnel, true);
    }
  });

  await t('events without email / type / sg_event_id are invalid', () => {
    assert.strictEqual(sg.classifyEvent({ event: 'bounce', sg_event_id: 'x' }).reason, 'NO_EMAIL');
    assert.strictEqual(sg.classifyEvent({ email: 'a@b.c', sg_event_id: 'x' }).reason, 'NO_EVENT_TYPE');
    assert.strictEqual(sg.classifyEvent({ email: 'a@b.c', event: 'open' }).reason, 'NO_SG_EVENT_ID');
    assert.strictEqual(sg.classifyEvent(null).valid, false);
  });

  await t('sg_event_id is made Firestore-safe without collisions', () => {
    assert.strictEqual(sg.eventDocId('a+b/c=='), 'a-b_c');
    assert.notStrictEqual(sg.eventDocId('a+b/c=='), sg.eventDocId('a+b+c=='));
  });

  await t('stored record carries no categories or custom args (PII discipline)', () => {
    const evt = bounceEvt({ category: 'cat facts', unique_args: { mrn: '123' }, marketing_campaign_name: 'x' });
    const rec = sg.buildEventRecord(evt, sg.classifyEvent(evt), NOW);
    assert.ok(!('category' in rec));
    assert.ok(!('unique_args' in rec));
    assert.ok(!('marketing_campaign_name' in rec));
    assert.ok(!('smtp-id' in rec));
  });

  // ---------- endpoint behaviour ----------
  await t('valid signed payload -> 200 and stored', async () => {
    const db = fakeDb();
    const { res, stats } = await post(db, [bounceEvt()]);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(stats.stored, 1);
    assert.ok(db.__data.has(`${EVENTS_COLLECTION}/a-b_c`));
  });

  await t('invalid signature -> 403 and NOTHING stored', async () => {
    const db = fakeDb();
    const { res } = await post(db, [bounceEvt()], { signature: Buffer.from('nope').toString('base64') });
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(db.__data.size, 0);
  });

  await t('missing signature -> 403 and NOTHING stored', async () => {
    const db = fakeDb();
    const { res } = await post(db, [bounceEvt()], { signature: null });
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(db.__data.size, 0);
  });

  await t('missing timestamp -> 403 and NOTHING stored', async () => {
    const db = fakeDb();
    const { res } = await post(db, [bounceEvt()], { timestamp: null });
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(db.__data.size, 0);
  });

  await t('GET is refused', async () => {
    const db = fakeDb();
    const { res } = await post(db, [], { method: 'GET' });
    assert.strictEqual(res.statusCode, 405);
    assert.strictEqual(db.__data.size, 0);
  });

  await t('non-JSON body with a valid signature -> 400, nothing stored', async () => {
    const db = fakeDb();
    const { res } = await post(db, null, { rawOverride: Buffer.from('not json') });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(db.__data.size, 0);
  });

  await t('bounce -> emailEvents AND emailSuppression', async () => {
    const db = fakeDb();
    const { stats } = await post(db, [bounceEvt()]);
    assert.strictEqual(stats.suppressed, 1);
    const row = db.__data.get(`${SUPPRESSION_COLLECTION}/bouncy@example.com`);
    assert.ok(row, 'suppression row written keyed by normalized email');
    assert.strictEqual(row.email, 'bouncy@example.com');
    assert.strictEqual(row.reason, 'hard_bounce');
    assert.strictEqual(row.firstSuppressedAtMs, NOW);
  });

  await t('delivered/open -> funnel only, no suppression row', async () => {
    const db = fakeDb();
    const { stats } = await post(db, [deliveredEvt(), deliveredEvt({ event: 'open', sg_event_id: 'open-1' })]);
    assert.strictEqual(stats.funnel, 2);
    assert.strictEqual(stats.suppressed, 0);
    const keys = [...db.__data.keys()];
    assert.ok(keys.every((k) => !k.startsWith(`${SUPPRESSION_COLLECTION}/`)));
    assert.strictEqual(keys.length, 2);
  });

  await t('duplicate sg_event_id -> one record, nothing re-applied', async () => {
    const db = fakeDb();
    await post(db, [bounceEvt()]);
    const first = db.__data.get(`${SUPPRESSION_COLLECTION}/bouncy@example.com`);
    const { stats } = await post(db, [bounceEvt()]);
    assert.strictEqual(stats.stored, 0);
    assert.strictEqual(stats.duplicates, 1);
    assert.strictEqual(stats.suppressed, 0);
    assert.strictEqual([...db.__data.keys()].filter((k) => k.startsWith(`${EVENTS_COLLECTION}/`)).length, 1);
    assert.deepStrictEqual(db.__data.get(`${SUPPRESSION_COLLECTION}/bouncy@example.com`), first);
  });

  await t('later event for an already-suppressed address keeps firstSuppressedAtMs', async () => {
    const db = fakeDb();
    await post(db, [bounceEvt()]);
    const res2 = makeRes();
    await handleEventWebhook({
      db,
      req: makeReq([bounceEvt({ sg_event_id: 'second', event: 'spamreport', type: undefined })], { timestamp: String(Math.floor((NOW + 60000) / 1000)) }),
      res: res2,
      publicKey: PUBLIC_B64,
      nowMs: NOW + 60000,
    });
    const row = db.__data.get(`${SUPPRESSION_COLLECTION}/bouncy@example.com`);
    assert.strictEqual(row.firstSuppressedAtMs, NOW);
    assert.strictEqual(row.reason, 'spam_complaint');
    assert.strictEqual(row.suppressedAtMs, NOW + 60000);
  });

  await t('mixed batch: suppression + funnel + invalid counted separately', async () => {
    const db = fakeDb();
    const { res, stats } = await post(db, [
      bounceEvt(),
      deliveredEvt(),
      { event: 'open' }, // invalid — no email, no id
    ]);
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(
      { received: stats.received, stored: stats.stored, suppressed: stats.suppressed, funnel: stats.funnel, invalid: stats.invalid },
      { received: 3, stored: 2, suppressed: 1, funnel: 1, invalid: 1 },
    );
  });

  await t('a write failure returns 500 so SendGrid retries', async () => {
    const db = fakeDb();
    const orig = db.collection.bind(db);
    db.collection = (c) => {
      const col = orig(c);
      if (c === EVENTS_COLLECTION) return { ...col, doc: () => ({ create: async () => { throw new Error('firestore down'); } }) };
      return col;
    };
    const { res } = await post(db, [bounceEvt()]);
    assert.strictEqual(res.statusCode, 500);
    assert.strictEqual(db.__data.size, 0, 'event and suppression must roll back together');
  });

  await t('suppression failure rolls back the event; retry restores both exactly once', async () => {
    const db = fakeDb();
    const original = db.collection.bind(db);
    let fail = true;
    db.collection = (name) => {
      const col = original(name);
      if (name !== SUPPRESSION_COLLECTION) return col;
      return { ...col, doc: (id) => {
        const ref = col.doc(id);
        return { ...ref, set: async (...args) => {
          if (fail) throw new Error('suppression unavailable');
          return ref.set(...args);
        } };
      } };
    };
    const first = await post(db, [bounceEvt()]);
    assert.strictEqual(first.res.statusCode, 500);
    assert.strictEqual(db.__data.size, 0);
    fail = false;
    const retry = await post(db, [bounceEvt()]);
    assert.strictEqual(retry.res.statusCode, 200);
    assert.strictEqual(retry.stats.stored, 1);
    assert.strictEqual(retry.stats.suppressed, 1);
    const duplicate = await post(db, [bounceEvt()]);
    assert.strictEqual(duplicate.stats.duplicates, 1);
    assert.strictEqual(db.__data.size, 2);
  });

  await t('portal receiver writes only emailEvents and emailSuppression, never CRM or patient records', async () => {
    const db = fakeDb();
    await post(db, [bounceEvt(), deliveredEvt(), bounceEvt({event:'spamreport',sg_event_id:'spam-1'}), bounceEvt({event:'dropped',sg_event_id:'drop-1'})]);
    assert.strictEqual([...db.__data.keys()].filter(k => k.startsWith('emailEvents/')).length, 4);
    assert.ok([...db.__data.keys()].every(k => k.startsWith('emailEvents/') || k.startsWith('emailSuppression/')));
  });

  // ---------- the shared surface with #558 / D-407 ----------
  await t('the autosender suppression read finds an address suppressed here', async () => {
    const db = fakeDb();
    await post(db, [bounceEvt()]);
    const loaded = await loadSuppressedEmails(db);
    assert.strictEqual(loaded.ok, true);
    assert.ok(loaded.emails.has('bouncy@example.com'), 'D-407 reader must see the D-408 row');
  });

  await t('a funnel-only address is NOT suppressed for the autosender', async () => {
    const db = fakeDb();
    await post(db, [deliveredEvt()]);
    const loaded = await loadSuppressedEmails(db);
    assert.strictEqual(loaded.emails.size, 0);
  });

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();

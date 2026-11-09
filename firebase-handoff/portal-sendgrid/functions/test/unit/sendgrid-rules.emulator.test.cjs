const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, getDocs, collection, setDoc, updateDoc, deleteDoc } = require('firebase/firestore');
const crypto = require('node:crypto');
const Module = require('node:module');
const admin = require('firebase-admin');
const originalLoad = Module._load;
Module._load = function (name) {
  if (name === 'firebase-functions') return { region: () => ({ runWith: () => ({ https: { onRequest: fn => fn } }) }) };
  if (name === '@google-cloud/secret-manager') return { SecretManagerServiceClient: class {} };
  return originalLoad.apply(this, arguments);
};
const { handleEventWebhook } = require('../../sendgridEventWebhook');
Module._load = originalLoad;
let server;

let env;
before(async () => {
  assert.equal(process.env.GCLOUD_PROJECT, 'demo-portal-sendgrid');
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'real emulator required');
  env = await initializeTestEnvironment({
    projectId: 'demo-portal-sendgrid',
    firestore: { rules: fs.readFileSync(path.resolve(__dirname, '../../../firestore.rules'), 'utf8') },
  });
  admin.initializeApp({ projectId: 'demo-portal-sendgrid' });
  server = admin.firestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    for (const name of ['emailEvents', 'emailSuppression']) {
      await setDoc(doc(db, name, 'fixture'), { event: 'bounce' });
    }
  });
});
after(async () => {
  if (env) await env.cleanup();
  if (server) await server.terminate();
  await Promise.all(admin.apps.map(app => app.delete()));
});

test('signed bounce/spam/delivered/dropped batch persists in real portal Firestore; duplicate concurrency is idempotent', async () => {
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const nowMs = Date.now();
  const timestamp = String(Math.floor(nowMs / 1000));
  const rawBody = Buffer.from(JSON.stringify(['bounce', 'spamreport', 'delivered', 'dropped'].map(event => ({
    email: `fixture-${event}@example.test`, event, sg_event_id: `real-${event}`, timestamp: Number(timestamp), type: 'bounce',
  }))));
  const signer = crypto.createSign('sha256'); signer.update(timestamp); signer.update(rawBody); signer.end();
  const signature = signer.sign(pair.privateKey).toString('base64');
  const request = { method: 'POST', rawBody, headers: {
    'x-twilio-email-event-webhook-signature': signature,
    'x-twilio-email-event-webhook-timestamp': timestamp,
  } };
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const post = async req => {
    const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handleEventWebhook({ db: server, req, res, publicKey, nowMs });
    return res;
  };
  const result = await post(request);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.stored, 4);
  assert.equal(result.body.suppressed, 3);
  for (const event of ['bounce', 'spamreport', 'delivered', 'dropped']) {
    assert.equal((await server.doc(`emailEvents/real-${event}`).get()).data().event, event);
    assert.equal((await server.doc(`emailSuppression/fixture-${event}@example.test`).get()).exists, event !== 'delivered');
  }
  const duplicates = await Promise.all([post(request), post(request)]);
  assert.ok(duplicates.every(res => res.statusCode === 200 && res.body.duplicates === 4 && res.body.suppressed === 0));
  const tampered = await post({ ...request, rawBody: Buffer.from('[]') });
  assert.equal(tampered.statusCode, 403);
});

for (const name of ['emailEvents', 'emailSuppression']) {
  for (const role of ['admin', 'super_admin']) {
    test(`${name}: ${role} can read and list`, async () => {
      const db = env.authenticatedContext(`fixture-${role}`, { role }).firestore();
      await assertSucceeds(getDoc(doc(db, name, 'fixture')));
      await assertSucceeds(getDocs(collection(db, name)));
    });
  }
  for (const role of [null, 'patient', 'staff', 'clinical', 'pharmacy', 'billing', 'hr']) {
    test(`${name}: ${role || 'anonymous'} cannot read or list`, async () => {
      const db = role === null ? env.unauthenticatedContext().firestore()
        : env.authenticatedContext(`fixture-${role}`, role === 'patient' ? {} : { role }).firestore();
      await assertFails(getDoc(doc(db, name, 'fixture')));
      await assertFails(getDocs(collection(db, name)));
    });
  }
  for (const role of [null, 'patient', 'staff', 'admin', 'super_admin']) {
    test(`${name}: ${role || 'anonymous'} client cannot create, update or delete`, async () => {
      const db = role === null ? env.unauthenticatedContext().firestore()
        : env.authenticatedContext(`fixture-${role}`, role === 'patient' ? {} : { role }).firestore();
      await assertFails(setDoc(doc(db, name, `new-${role}`), { event: 'delivered' }));
      await assertFails(updateDoc(doc(db, name, 'fixture'), { event: 'delivered' }));
      await assertFails(deleteDoc(doc(db, name, 'fixture')));
    });
  }
}
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const admin = require('firebase-admin');
const fs = require('node:fs');
if (!String(process.env.GCLOUD_PROJECT).startsWith('demo-') || !process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST) throw new Error('isolated emulators required');
admin.initializeApp({ projectId:process.env.GCLOUD_PROJECT });
const db=admin.firestore(), auth=admin.auth();
const key=fs.readFileSync(process.env.SOCIAL_TEST_KEY_FILE);
const base=`http://127.0.0.1:5001/${process.env.GCLOUD_PROJECT}/us-central1`;
let bearer;
const uid='StaffTrueCase', pid='STAFF-CHART';
function provider(a, extra={}) {
  const now=Math.floor(Date.now()/1000), enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
  const p=enc({ alg:'RS256',kid:'test' })+'.'+enc({ iss:'https://accounts.google.com',aud:'fixture-client',sub:'provider-subject',email:'fixture@example.test',email_verified:true,iat:now,exp:now+300,nonce:a.nonce,...extra });
  return p+'.'+crypto.sign('RSA-SHA256',Buffer.from(p),key).toString('base64url');
}
async function call(name,data={},token=bearer) {
  const r=await fetch(`${base}/${name}`,{ method:'POST',headers:{ 'Content-Type':'application/json',...(token ? { Authorization:`Bearer ${token}` }: {}) },body:JSON.stringify({ data }) });
  return r.json();
}
async function begin() { const j=await call('socialBeginAttempt',{ providerId:'google.com' });assert.ok(j.result);return j.result; }
function identity(a,extra={}) { return { attemptId:a.attemptId,proof:a.proof,providerId:'google.com',idToken:provider(a,extra) }; }
beforeEach(async()=>{
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`,{ method:'DELETE' });
  await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/accounts`,{ method:'DELETE' });
  await auth.createUser({ uid,email:'fixture@example.test',password:'FixturePass2468' });
  await db.doc(`patients/${pid}`).set({ authUid:uid,firebaseUid:uid.toLowerCase(),firstName:'Fixture',lastName:'Staff',dob:'1980-01-02',status:'active',practiceId:'default' });
  await db.doc('config/socialSignIn').set({ enabled:true });await db.doc('config/socialSignIn/practices/default').set({ enabled:true });
  await db.doc(`socialStaffTargets/${uid}`).set({ enabled:true,practiceId:'default' });
  const r=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fixture`,{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify({ email:'fixture@example.test',password:'FixturePass2468',returnSecureToken:true }) });
  bearer=(await r.json()).idToken;assert.ok(bearer);
});
test('non-PHI availability hides anonymous and flag-off staff',async()=>{
  assert.deepEqual((await call('socialAvailability',{},null)).result,{ google:false,apple:false });
  await db.doc('config/socialSignIn').update({ enabled:false });
  assert.deepEqual((await call('socialAvailability')).result,{ google:false,apple:false });
  assert.ok((await call('socialBeginAttempt',{ providerId:'google.com' })).error);
});
test('real callable A returns only server custom token preserving true-case UID/password',async()=>{
  const a=await begin(), j=await call('socialLinkExisting',identity(a));assert.equal(j.result.path,'A');assert.ok(j.result.customToken);
  const r=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fixture`,{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify({ token:j.result.customToken,returnSecureToken:true }) });
  assert.equal(r.status,200);assert.equal((await auth.verifyIdToken((await r.json()).idToken)).uid,uid);
  assert.deepEqual((await auth.getUser(uid)).providerData.map(p=>p.providerId),['password']);
});
test('wrong nonce fails before mapping/send/mint',async()=>{
  const a=await begin();assert.ok((await call('socialLinkExisting',identity(a,{ nonce:'wrong' }))).error);
  assert.equal((await db.collection('socialIdentityLinks').get()).size,0);assert.equal((await db.collection('__testSends').get()).size,0);
});
test('A replay/concurrent invocation cannot mint twice',async()=>{
  const a=await begin(), data=identity(a);const r=await Promise.all([call('socialLinkExisting',data),call('socialLinkExisting',data)]);
  assert.equal(r.filter(x=>x.result && x.result.customToken).length,1);assert.equal(r.filter(x=>x.error).length,1);
  assert.ok((await call('socialLinkExisting',data)).error);
});
test('path C conflicting binding never creates a mapping or custom token',async()=>{
  await db.doc('patients/DUPLICATE').set({ firebaseUid:uid.toLowerCase(),authUid:uid,dob:'1980-01-02' });
  const a=await begin(), r=await call('socialLinkExisting',identity(a));assert.equal(r.result.path,'C');assert.equal(r.result.customToken,undefined);
  assert.equal((await db.collection('socialIdentityLinks').get()).size,0);
});
test('relay/unverified-email B uses live chart verification, bound attempt and preserved UID',async()=>{
  const a=await begin(), data=identity(a,{ email:'relay@privaterelay.appleid.com',email_verified:false });
  assert.equal((await call('socialLinkExisting',data)).result.path,'B');
  const started=await call('socialStartVerification',{ ...data,firstName:'Fixture',lastName:'Staff',dob:'1980-01-02' });assert.ok(started.result.challengeId);
  const done=await call('socialConfirmVerification',{ ...data,challengeId:started.result.challengeId,code:'246810' });assert.equal(done.result.path,'B');
  assert.equal((await auth.getUser(uid)).uid,uid);assert.deepEqual((await auth.getUser(uid)).providerData.map(p=>p.providerId),['password']);
  assert.ok((await call('socialConfirmVerification',{ ...data,challengeId:started.result.challengeId,code:'246810' })).error);
});
test('B cross-attempt challenge substitution is refused',async()=>{
  const a=await begin(), data=identity(a,{ email_verified:false });await call('socialLinkExisting',data);
  const started=await call('socialStartVerification',{ ...data,firstName:'Fixture',lastName:'Staff',dob:'1980-01-02' });
  await db.doc(`socialAttempts/${a.attemptId}`).update({ challengeId:'another-challenge' });
  assert.ok((await call('socialConfirmVerification',{ ...data,challengeId:started.result.challengeId,code:'246810' })).error);
  assert.equal((await db.collection('socialIdentityLinks').get()).size,0);
});
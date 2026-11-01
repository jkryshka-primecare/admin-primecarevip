const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const S = require('../core/services/auth/socialSession');
if (!String(process.env.GCLOUD_PROJECT).startsWith('demo-') || !process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST) throw new Error('demo Auth/Firestore emulators required');
admin.initializeApp({ projectId:process.env.GCLOUD_PROJECT });
const db=admin.firestore(), auth=admin.auth();
const uid='TrueCaseMemberUid', pid='TEST-MEMBER';
const id={ providerId:'google.com', providerUid:'provider-sub', nonce:'server-nonce' };
beforeEach(async()=>{
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`,{ method:'DELETE' });
  await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/accounts`,{ method:'DELETE' });
  await auth.createUser({ uid, email:'fixture@example.test',password:'FixturePass2468' });
  await db.doc(`patients/${pid}`).set({ authUid:uid, firebaseUid:uid.toLowerCase(), dob:'1980-01-02', status:'active' });
});
test('logical link preserves true-case UID/password, adds no native provider',async()=>{
  assert.equal((await S.link(db,uid,id,pid)).linked,true);
  const u=await auth.getUser(uid); assert.equal(u.uid,uid);assert.deepEqual(u.providerData.map(p=>p.providerId),['password']);
  assert.equal((await db.collection('socialIdentityLinks').doc(S.identityKey(id)).get()).get('uid'),uid);
});
test('same identity/same UID is idempotent',async()=>{
  await S.link(db,uid,id,pid);assert.equal((await S.link(db,uid,id,pid)).linked,false);
});
test('expired worker cleanup cannot modify successor lease',async()=>{
  const ref=db.doc('socialClaimLocks/LEASE');const next={state:'pending',pendingUid:'successor',generation:'B',leaseUntilMs:Date.now()+120000};
  await ref.set(next);
  assert.equal(await S.settleLease(db,ref,'old','A',{state:'reconciliation',pendingUid:null}),false);
  assert.deepEqual((await ref.get()).data(),next);
});
test('practice transfer after wrapper precheck prevents mapping commit',async()=>{
  const access={uid,practiceId:'default'};
  await db.doc('config/socialSignIn').set({enabled:true});await db.doc('config/socialSignIn/practices/default').set({enabled:true});await db.doc(`socialStaffTargets/${uid}`).set({enabled:true,practiceId:'default'});
  await db.doc(`patients/${pid}`).update({practiceId:'other'});
  await assert.rejects(S.link(db,uid,id,pid,{access}),/PRACTICE_SCOPE_CHANGED/);
  assert.equal((await db.collection('socialIdentityLinks').get()).size,0);
});
test('suspension after wrapper precheck prevents mapping commit',async()=>{
  const logic=require('../core/services/auth/socialSignIn');
  await db.doc(`patients/${pid}`).update({portalAccess:{status:'suspended'}});
  await assert.rejects(S.link(db,uid,id,pid,{eligibility:logic.eligibility}),/MEMBER_INELIGIBLE/);
  assert.equal((await db.collection('socialIdentityLinks').get()).size,0);
});
test('concurrent identity ownership allows only one UID',async()=>{
  const other='OtherTrueCase';await auth.createUser({ uid:other });await db.doc('patients/OTHER').set({ authUid:other,firebaseUid:other.toLowerCase() });
  const r=await Promise.allSettled([S.link(db,uid,id,pid),S.link(db,other,id,'OTHER')]);
  assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(r.filter(x=>x.status==='rejected').length,1);
});
test('different identity cannot replace occupied provider slot',async()=>{
  await S.link(db,uid,id,pid);await assert.rejects(S.link(db,uid,{ ...id,providerUid:'other' },pid),/PROVIDER_SLOT_OWNED/);
});
test('missing or conflicting true-case binding refuses with no mapping',async()=>{
  await db.doc(`patients/${pid}`).update({ authUid:'wrong' });await assert.rejects(S.link(db,uid,id,pid),/BINDING_MISMATCH/);
  assert.equal((await db.collection('socialIdentityLinks').get()).size,0);
});
test('duplicate record binding refuses',async()=>{
  await db.doc('patients/DUP').set({ authUid:uid,firebaseUid:uid.toLowerCase() });await assert.rejects(S.link(db,uid,id,pid),/AMBIGUOUS_BINDING/);
});
test('claim binds roster and identity atomically under its live lease',async()=>{
  const newUid='ClaimNewTrueCase';await auth.createUser({ uid:newUid });await db.doc('patients/NEW').set({ dob:'1980-01-02' });
  await db.doc('socialClaimLocks/NEW').set({ state:'pending',pendingUid:newUid,leaseUntilMs:Date.now()+120000 });
  await S.link(db,newUid,id,'NEW',{ claimUid:newUid });
  assert.equal((await db.doc('patients/NEW').get()).get('authUid'),newUid);
  assert.equal((await db.collection('socialIdentityLinks').doc(S.identityKey(id)).get()).get('uid'),newUid);
});
test('expired claim lease never binds or creates a mapping',async()=>{
  await db.doc('patients/NEW').set({});await db.doc('socialClaimLocks/NEW').set({ state:'pending',pendingUid:'new',leaseUntilMs:Date.now()-1 });
  await assert.rejects(S.link(db,'new',id,'NEW',{ claimUid:'new' }),/CLAIM_LEASE_LOST/);
  assert.equal((await db.collection('socialIdentityLinks').get()).size,0);assert.equal((await db.doc('patients/NEW').get()).get('authUid'),undefined);
});
test('attempt completion is atomic and replays fail',async()=>{
  const access={ uid,practiceId:'default',google:true,apple:false };const a=await S.begin(db,'google.com',access);const bound={ ...id,nonce:a.nonce };
  const results=await Promise.allSettled([S.advance(db,a,bound,['new'],'done'),S.advance(db,a,bound,['new'],'done')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
  await assert.rejects(S.advance(db,a,bound,['new'],'done'),/ATTEMPT_USED/);
});
test('staff availability fails closed for anonymous/off/untargeted/disabled users',async()=>{
  const env={ SOCIAL_GOOGLE_CLIENT_IDS:'fixture' };
  assert.equal(await S.staffAccess(db,auth,{},env),null);
  assert.equal(await S.staffAccess(db,auth,{ auth:{ uid } },env),null);
  await db.doc('config/socialSignIn').set({ enabled:true });await db.doc('config/socialSignIn/practices/default').set({ enabled:true });
  assert.equal(await S.staffAccess(db,auth,{ auth:{ uid } },env),null);
  await db.doc(`socialStaffTargets/${uid}`).set({ enabled:true,practiceId:'default' });
  assert.equal((await S.staffAccess(db,auth,{ auth:{ uid } },env)).google,true);
  await auth.updateUser(uid,{ disabled:true });assert.equal(await S.staffAccess(db,auth,{ auth:{ uid } },env),null);
});
test('fresh password and custom-token sign-ins read back same true-case UID',async()=>{
  await S.link(db,uid,id,pid);
  const post=async(name,data)=>{ const r=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:${name}?key=fixture`,{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify(data) });assert.equal(r.status,200);return r.json(); };
  const p=await post('signInWithPassword',{ email:'fixture@example.test',password:'FixturePass2468',returnSecureToken:true });assert.equal(p.localId,uid);
  const c=await post('signInWithCustomToken',{ token:await auth.createCustomToken(uid),returnSecureToken:true });assert.equal((await auth.verifyIdToken(c.idToken)).uid,uid);
  assert.deepEqual((await auth.getUser(uid)).providerData.map(p=>p.providerId),['password']);
});
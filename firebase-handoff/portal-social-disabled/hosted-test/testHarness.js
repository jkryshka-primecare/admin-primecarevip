// Disposable project only. No production imports, credentials, charts or sends.
const admin=require('firebase-admin');
const {onRequest}=require('firebase-functions/v2/https');
const {verifyProviderIdToken}=require('./core/services/auth/providerToken');
const Session=require('./core/services/auth/socialSession');
const PROJECT='pcvip-social-test', ACTOR='GoogleHarnessOperator04', UID='SyntheticGoogleTrueCase04', PID='synthetic-google-chart04';
const END=Date.UTC(2026,10,6,23,59);
const EMAIL='bethebatmanbot@gmail.com';
const db=()=>admin.firestore();
const origins=new Set([`https://${PROJECT}.web.app`,`https://${PROJECT}.firebaseapp.com`]);
async function ensure(uid,email){try{return await admin.auth().getUser(uid);}catch(e){if(e.code!=='auth/user-not-found')throw e;return admin.auth().createUser({uid,...(email?{email}:{})});}}
async function call(name,data,bearer){const r=await fetch(`https://us-central1-${PROJECT}.cloudfunctions.net/${name}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${bearer}`},body:JSON.stringify({data})});return r.json();}
async function bearer(){const token=await admin.auth().createCustomToken(ACTOR);const r=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.TEST_FIREBASE_API_KEY}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,returnSecureToken:true})});const j=await r.json();if(!j.idToken)throw Error('TEST_OPERATOR_UNAVAILABLE');return j.idToken;}
async function flags(on){await Promise.all([db().doc('config/socialSignIn').set({enabled:on}),db().doc('config/socialSignIn/practices/default').set({enabled:on})]);}
exports.testGoogleHarness=onRequest({region:'us-central1',timeoutSeconds:180,memory:'512MiB'},async(req,res)=>{
 res.set('Cache-Control','no-store');const origin=req.get('origin');if(origins.has(origin))res.set('Access-Control-Allow-Origin',origin);res.set('Access-Control-Allow-Headers','Content-Type');
 if(req.method==='OPTIONS')return res.status(204).send('');
 if(process.env.GCLOUD_PROJECT!==PROJECT||Date.now()>END||!origins.has(origin)||req.method!=='POST')return res.status(403).json({error:'TEST_CLOSED'});
 let active=false,ownsLease=false,stage='REQUEST';
 try{
 const scenario=req.body?.scenario;if(!['A','B','C'].includes(scenario))throw Error('INVALID_SCENARIO');
 if(req.body.action==='prepare'){
  // One global, expiring test lease prevents different browser runs from racing fixtures.
  await db().runTransaction(async tx=>{const ref=db().doc('__googleHarness/lease'),s=await tx.get(ref);if(s.exists&&s.get('until')>Date.now())throw Error('TEST_BUSY');tx.set(ref,{until:Date.now()+600000,scenario});});
  ownsLease=true;
  // No public request can arm flags. Prepare only the server-bound nonce.
  active=true;
  const a=await Session.begin(db(),'google.com',{uid:ACTOR,practiceId:'default',google:true,apple:false});
  await db().doc('__googleHarness/lease').set({scenario,attemptId:a.attemptId},{merge:true});
  return res.json(a);
 }
 if(req.body.action!=='complete')throw Error('INVALID_ACTION');
 const lease=await db().doc('__googleHarness/lease').get();if(lease.get('scenario')!==scenario||lease.get('attemptId')!==req.body.attemptId||lease.get('until')<Date.now())throw Error('TEST_EXPIRED');
 const a=await db().doc(`socialAttempts/${req.body.attemptId}`).get();
 stage='PROVIDER_VALIDATION';
 const id=await verifyProviderIdToken('google.com',req.body.idToken,{nonceHash:a.get('nonceHash')});
 if(id.email!==EMAIL||!id.emailVerified)throw Error('TEST_ACCOUNT_REQUIRED');
 Session.gate(a.data(),req.body.proof,Date.now(),['new']);
 ownsLease=true;
 // Fixture mutations require the genuine, designated Google identity first.
 stage='SYNTHETIC_SETUP';
 await ensure(ACTOR);await ensure(UID);
 await admin.auth().updateUser(UID,{email:scenario==='B'?'synthetic-google-login@example.test':EMAIL});
 await db().doc(`patients/${PID}`).set({authUid:UID,firebaseUid:UID.toLowerCase(),firstName:'Synthetic',lastName:'Google',dob:'1980-01-02',status:'active',practiceId:'default'});
 await db().doc('patients/synthetic-google-duplicate04').delete();
 if(scenario==='C')await db().doc('patients/synthetic-google-duplicate04').set({authUid:UID,firebaseUid:UID.toLowerCase(),dob:'1980-01-02',practiceId:'default'});
 const mappings=await db().collection('socialIdentityLinks').where('uid','==',UID).get();for(const d of mappings.docs)await d.ref.delete();
 await db().collection('socialIdentitySlots').doc(Session.digest(`${UID}\0google.com`)).delete();
 await db().doc(`socialStaffTargets/${ACTOR}`).set({enabled:true,practiceId:'default'});
 active=true;await flags(true);
 stage='OPERATOR_TOKEN';
 const b=await bearer(),data={attemptId:req.body.attemptId,proof:req.body.proof,providerId:'google.com',idToken:req.body.idToken};
 const direct=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${process.env.TEST_FIREBASE_API_KEY}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestUri:`https://${PROJECT}.web.app`,postBody:new URLSearchParams({id_token:req.body.idToken,providerId:'google.com'}).toString(),returnSecureToken:true})});
 const dj=await direct.json(),refused=dj.error?.message?.startsWith('OPERATION_NOT_ALLOWED')===true;
 stage='LINK_EXISTING';
 const linked=await call('socialLinkExisting',data,b);if(linked.result?.path!==scenario)throw Error('UNEXPECTED_PATH');
 let done=linked;
 if(scenario==='B'){
  stage='B_START';
  const start=await call('socialStartVerification',{...data,firstName:'Synthetic',lastName:'Google',dob:'1980-01-02'},b);if(!start.result?.challengeId)throw Error('B_START_REFUSED');
  stage='B_CONFIRM';
  done=await call('socialConfirmVerification',{...data,challengeId:start.result.challengeId,code:'246810'},b);
 }
 let preserved=null;
 if(scenario!=='C'){
  stage='CUSTOM_TOKEN_EXCHANGE';
  if(!done.result?.customToken)throw Error('NO_CUSTOM_TOKEN');
  const r=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${process.env.TEST_FIREBASE_API_KEY}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:done.result.customToken,returnSecureToken:true})});const j=await r.json();
  // signInWithCustomToken returns idToken/refreshToken only (no localId); read the signed-in UID from the verified ID token.
  const signedIn=j.idToken?await admin.auth().verifyIdToken(j.idToken).catch(()=>null):null;preserved=signedIn?.uid===UID;if(!preserved)throw Error('UID_NOT_PRESERVED');
 }else if(done.result?.customToken)throw Error('C_MINTED_TOKEN');
 stage='REPLAY';
 const replay=await call('socialLinkExisting',data,b);
 const result={scenario,directOAuthRefused:refused,trueCaseUidPreserved:preserved,logicalFlow:scenario==='C'?'REFUSED':'SUCCEEDED',replayRefused:!!replay.error,providerValidation:'GENUINE_GOOGLE',integrations:scenario==='B'?'SYNTHETIC_ADAPTERS':'NOT_USED',passed:refused&&(scenario==='C'||preserved)&&!!replay.error};
 stage='RESULT_WRITE';
 await db().doc(`__googleHarnessResults/${scenario}`).set({...result,at:admin.firestore.FieldValue.serverTimestamp()});
 return res.json(result);
 }catch(e){const error=['TEST_BUSY','TEST_EXPIRED','TEST_ACCOUNT_REQUIRED','INVALID_SCENARIO','UNEXPECTED_PATH','B_START_REFUSED','NO_CUSTOM_TOKEN','UID_NOT_PRESERVED','C_MINTED_TOKEN','TEST_OPERATOR_UNAVAILABLE'].includes(e.message)?e.message:'TEST_FAILED';console.warn('GOOGLE_HARNESS_FAILED',JSON.stringify({stage,error}));return res.status(400).json({error,stage});}
 finally{if(ownsLease&&(req.body?.action==='complete'||!active)){await flags(false).catch(()=>{});await db().doc('__googleHarness/lease').set({until:0},{merge:true}).catch(()=>{});}}
});

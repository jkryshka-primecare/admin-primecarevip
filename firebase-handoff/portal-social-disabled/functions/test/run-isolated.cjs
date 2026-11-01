// Local-only runner: staged dependencies supplied outside the admin app.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const { spawnSync }=require('node:child_process');
const root=path.resolve(__dirname,'../..');
if (!process.env.SOCIAL_TEST_NODE_MODULES) throw new Error('SOCIAL_TEST_NODE_MODULES required');
const stage=fs.mkdtempSync(path.join(os.tmpdir(),'social-isolated-'));
const f=path.join(stage,'functions');fs.cpSync(path.join(root,'functions'),f,{ recursive:true });
fs.symlinkSync(process.env.SOCIAL_TEST_NODE_MODULES,path.join(f,'node_modules'),'dir');
fs.writeFileSync(path.join(f,'package.json'),JSON.stringify({ main:'index.js',engines:{ node:'22' },dependencies:{ 'firebase-admin':'12.7.0','firebase-functions':'5.1.1' } }));
const put=(name,s)=>{ const p=path.join(f,name);fs.mkdirSync(path.dirname(p),{ recursive:true });fs.writeFileSync(p,s); };
const pair=crypto.generateKeyPairSync('rsa',{ modulusLength:2048 });const keyFile=path.join(stage,'fixture-key.pem');
fs.writeFileSync(keyFile,pair.privateKey.export({ type:'pkcs8',format:'pem' }),{ mode:0o600 });
const jwk={ ...pair.publicKey.export({ format:'jwk' }),kid:'test' };
put('index.js',`const admin=require('firebase-admin');admin.initializeApp();const original=global.fetch;const jwk=${JSON.stringify(jwk)};global.fetch=async(url,...args)=>String(url).includes('/oauth2/v3/certs')||String(url).includes('/auth/keys')?{ok:true,json:async()=>({keys:[jwk]})}:original(url,...args);module.exports=require('./socialSignIn');`);
put('middleware/logger.js',`exports.logError=()=>{};`);
put('core/services/auth/verifySender.js',`const admin=require('firebase-admin');exports.VERIFY_SECRET_NAMES=[];exports.startVerification=async()=>{await admin.firestore().collection('__testSends').add({sent:true});return {verificationSid:'fixture-verification'};};exports.checkVerification=async({code})=>({approved:code==='246810'});`);
put('core/services/patient/dobThrottle.js',`exports.checkThrottle=async()=>({blocked:false});exports.recordFailure=async()=>{};exports.clearThrottle=async()=>{};`);
put('core/services/patient/postClaim.js',`exports.runPostClaimSteps=async()=>{};`);
put('core/services/elation/client.js',`exports.elationGet=async()=>({dob:'1980-01-02',phones:[{phone:'305-555-0199',phone_type:'Mobile'}]});`);
put('.env',`SOCIAL_GOOGLE_CLIENT_IDS=fixture-client\nSOCIAL_APPLE_CLIENT_IDS=fixture-apple\n`);
put('.secret.local','ELATION_CLIENT_ID=fixture\nELATION_CLIENT_SECRET=fixture\n');
fs.writeFileSync(path.join(stage,'firebase.json'),JSON.stringify({ functions:[{ source:'functions',codebase:'portal-functions' }],emulators:{ auth:{port:9099},firestore:{port:8085},functions:{port:5001},ui:{enabled:false} } }));
const cli=path.join(process.env.SOCIAL_TEST_NODE_MODULES,'firebase-tools/lib/bin/firebase.js');
const command=`node --test ${path.join(f,'test/callable-flow.emulator.test.cjs')}`;
const r=spawnSync(process.execPath,[cli,'emulators:exec','--config',path.join(stage,'firebase.json'),'--project','demo-social-callables','--only','auth,firestore,functions',command],{
 cwd:stage,stdio:'inherit',env:{...process.env,NODE_PATH:process.env.SOCIAL_TEST_NODE_MODULES,SOCIAL_TEST_KEY_FILE:keyFile}
});
fs.rmSync(stage,{recursive:true,force:true});process.exit(r.status === null ? 1 : r.status);
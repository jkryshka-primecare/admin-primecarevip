const {test}=require('node:test');const assert=require('node:assert/strict');const Module=require('node:module');
function harness({wrongBinding=false,liveLease=false,status='pending',result='complete'}={}) {
  let called=0,deferred=0;const job={rawUid:'TrueCaseUID',state:liveLease?'running':'queued',leaseUntilMs:liveLease?Date.now()+180000:0};
  const patient={authUid:wrongBinding?'wrong':'TrueCaseUID',firebaseUid:'truecaseuid',hydrationStatus:status};
  const jobRef={set:async data=>Object.assign(job,data)};
  const patientRef={get:async()=>({get:key=>patient[key]})};
  const db={collection:()=>({doc:()=>patientRef}),runTransaction:fn=>fn({get:async ref=>ref===jobRef?{data:()=>job}:{exists:true,data:()=>patient},set:(ref,data)=>Object.assign(job,data)})};
  const firestore=()=>db;firestore.FieldValue={serverTimestamp:()=>0};
  const chain={region:()=>chain,runWith:()=>chain,firestore:{document:()=>chain},onCreate:fn=>fn};
  const original=Module._load;
  Module._load=function(name,parent,...rest){
    if(name==='firebase-admin')return {firestore};
    if(name==='firebase-functions')return chain;
    if(name==='./core/services/patient/postClaim')return {runPostClaimSteps:async args=>{assert.equal(args.ownsPending,true);called++;patient.hydrationStatus=result;}};
    if(name==='./core/services/patient/hydrationStatus')return {markDeferred:async()=>{deferred++;patient.hydrationStatus='deferred';}};
    return original.call(this,name,parent,...rest);
  };
  const path=require.resolve('../../claimHydrationWorker');delete require.cache[path];
  let worker;try{worker=require(path).claimHydrationWorker;}finally{Module._load=original;}
  return {run:()=>worker({ref:jobRef,data:()=>job},{params:{patientId:'123456'}}),job,patient,get called(){return called},get deferred(){return deferred}};
}
test('worker owns queued pending and finishes once',async()=>{const h=harness();await h.run();await h.run();assert.equal(h.called,1);assert.equal(h.job.state,'done');assert.equal(h.patient.hydrationStatus,'complete');});
test('worker refuses wrong exact binding before hydration',async()=>{const h=harness({wrongBinding:true});await assert.rejects(h.run(),/BINDING_MISMATCH/);assert.equal(h.called,0);});
test('concurrent delivery cannot take a live worker lease',async()=>{const h=harness({liveLease:true});await assert.rejects(h.run(),/WORKER_LEASE_LIVE/);assert.equal(h.called,0);});
test('unfinished worker hands pending to deferred safety net',async()=>{const h=harness({result:'pending'});await h.run();assert.equal(h.deferred,1);assert.equal(h.patient.hydrationStatus,'deferred');});
test('failed records are not restarted automatically',async()=>{const h=harness({status:'failed'});await h.run();assert.equal(h.called,0);});
const admin=require('firebase-admin');const dns=require('dns').promises;const fs=require('fs');
admin.initializeApp({credential:admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))});
const db=admin.firestore();
const OUT='/mnt/documents/invite-validation-2026-11-10';fs.mkdirSync(OUT,{recursive:true});
const norm=s=>(s||'').trim().toLowerCase();
const COMMON=['gmail.com','yahoo.com','hotmail.com','outlook.com','icloud.com','aol.com','live.com','msn.com','me.com','comcast.net','att.net','verizon.net','sbcglobal.net','protonmail.com','ymail.com','mac.com','cox.net','charter.net','bellsouth.net','earthlink.net','primecarevip.com','mail.com','gmx.com','zoho.com'];
const DISPOSABLE=new Set(['mailinator.com','guerrillamail.com','10minutemail.com','tempmail.com','temp-mail.org','yopmail.com','trashmail.com','sharklasers.com','getnada.com','dispostable.com','maildrop.cc','throwawaymail.com','fakeinbox.com','mintemail.com','emailondeck.com']);
const ROLE=new Set(['info','admin','support','office','contact','sales','billing','help','noreply','no-reply','hello','team','webmaster','postmaster','abuse','accounts','hr','reception','frontdesk','mail']);
const SYNTAX=/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
function lev(a,b){const d=Array.from({length:a.length+1},(_,i)=>[i]);for(let j=1;j<=b.length;j++)d[0][j]=j;for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return d[a.length][b.length];}
const typo=dom=>{if(COMMON.includes(dom))return null;for(const c of COMMON){const L=lev(dom,c);if(L>0&&L<=(c.length<=7?1:2)&&Math.abs(dom.length-c.length)<=2)return c;}
 const m=dom.match(/^(gmail|yahoo|hotmail|outlook|icloud|aol)\.(co|cm|con|om|comm|cmo|net)$/);return m&&m[0]!==m[1]+'.com'?m[1]+'.com':null;};
const dcache=new Map();
async function domainOk(dom){if(dcache.has(dom))return dcache.get(dom);
 const p=(async()=>{const t=async f=>{try{const r=await f();return r&&r.length?'yes':'no'}catch(e){return ['ENOTFOUND','ENODATA','NXDOMAIN'].includes(e.code)?'no':'err:'+e.code}};
  const mx=await t(()=>dns.resolveMx(dom)); if(mx==='yes')return 'MX';
  const a=await t(()=>dns.resolve4(dom)); if(a==='yes')return 'A';
  const a6=await t(()=>dns.resolve6(dom)); if(a6==='yes')return 'A';
  return [mx,a,a6].some(x=>x.startsWith('err'))?'LOOKUP_ERROR':'NONE';})();
 dcache.set(dom,p);return p;}
(async()=>{
 // Hint active members
 const key=process.env.HINT_PRACTICE_API_KEY;let hint=[];
 for(let off=0;;off+=100){const r=await fetch(`https://api.hint.com/api/provider/patients?limit=100&offset=${off}`,{headers:{Authorization:'Bearer '+key}});if(!r.ok)throw new Error('hint '+r.status);const j=await r.json();hint.push(...j);if(j.length<100)break;}
 const active=hint.filter(p=>p.membership_status==='active');
 const pats=(await db.collection('patients').get()).docs.map(d=>({id:d.id,...d.data()}));
 const byHint=new Map(),byND=new Map();
 for(const p of pats){if(p.hintPatientId)byHint.set(p.hintPatientId,p);const k=norm(p.firstName)+'|'+norm(p.lastName)+'|'+p.dob;(byND.get(k)||byND.set(k,[]).get(k)).push(p);}
 const toks=(await db.collection('claimTokens').get()).docs.map(d=>d.data());const tokBy=new Map();
 for(const t of toks){if(!t.elationPatientId)continue;(tokBy.get(t.elationPatientId)||tokBy.set(t.elationPatientId,[]).get(t.elationPatientId)).push(t);}
 const supp=new Set((await db.collection('emailSuppression').get()).docs.map(d=>norm(d.data().email||d.id)));
 const bounced=new Set((await db.collection('emailEvents').get()).docs.map(d=>d.data()).filter(e=>['bounce','dropped','spamreport'].includes(e.event)||e.suppressing).map(e=>norm(e.email)));
 const now=Date.now();const cands=[];const bucketCounts={};
 for(const h of active){
  let p=byHint.get(h.id);if(!p){const c=byND.get(norm(h.first_name)+'|'+norm(h.last_name)+'|'+h.dob)||byND.get(norm(h.chosen_first_name)+'|'+norm(h.last_name)+'|'+h.dob)||[];if(c.length===1)p=c[0];}
  let bucket;
  if(!p)bucket='no_account';
  else if(p.authUid||p.firebaseUid){bucket=p.hydrationStatus==='complete'?'hydrated':'claimed_not_hydrated';}
  else{const ts=tokBy.get(p.elationPatientId)||[];const live=ts.some(t=>!t.usedAt&&!t.revokedAt&&t.expiresAt&&t.expiresAt.toMillis()>now);bucket=live?'live_invite':ts.length?'expired_invite':'never_invited';}
  bucketCounts[bucket]=(bucketCounts[bucket]||0)+1;if(bucket==='hydrated')continue;
  const minor=(h.age!=null&&h.age<18)||!!(p&&p.dependent&&p.dependent.isDependent);
  cands.push({memberId:p?p.id:'', hintId:h.id, elationId:p?p.elationPatientId||'':'', bucket, minor, email:norm(p&&p.email||h.email), engaged:h.last_engagement_date||''});
 }
 // classify per unique email
 const byEmail=new Map();for(const c of cands){if(!c.email)continue;(byEmail.get(c.email)||byEmail.set(c.email,[]).get(c.email)).push(c);}
 const res=new Map();
 for(const em of byEmail.keys()){let o,reason,sugg='';
  if(supp.has(em)){o='excluded';reason='ALREADY_SUPPRESSED';}
  else if(bounced.has(em)){o='excluded';reason='KNOWN_BOUNCE';}
  else if(!SYNTAX.test(em)){o='correction';reason='BAD_SYNTAX';}
  else{const [local,dom]=em.split('@');const t=typo(dom);
   if(t){o='correction';reason='LIKELY_DOMAIN_TYPO';sugg=t;}
   else{const d=await domainOk(dom);
    if(d==='NONE'){o='suppress';reason='NO_MX_OR_A';}
    else if(d==='LOOKUP_ERROR'){o='correction';reason='DNS_LOOKUP_ERROR';}
    else if(ROLE.has(local.split('+')[0])){o='risky';reason='ROLE_ADDRESS';}
    else if(DISPOSABLE.has(dom)){o='risky';reason='DISPOSABLE_DOMAIN';}
    else{o='send';reason=d;}}}
  res.set(em,{o,reason,sugg});}
 // outputs
 const order={live_invite:1,claimed_not_hydrated:2,never_invited:3,no_account:4,expired_invite:5};
 const rows=[];const sum={outcome:{},noEmail:0,minorHeld:0,members:cands.length,uniqueEmails:byEmail.size,sharedEmails:[...byEmail.values()].filter(v=>v.length>1).length,domains:dcache.size};
 for(const c of cands){if(!c.email){sum.noEmail++;continue;}const r=res.get(c.email);let o=r.o;if(c.minor&&(o==='send'||o==='risky')){o='held_minor';sum.minorHeld++;}
  rows.push({...c,outcome:o,reason:r.reason,suggestion:r.sugg});sum.outcome[o]=(sum.outcome[o]||0)+1;}
 const csv=(f,h,rs)=>fs.writeFileSync(`${OUT}/${f}`,[h.join(',')].concat(rs.map(r=>h.map(k=>JSON.stringify(r[k]??'')).join(','))).join('\n')+'\n');
 const send=rows.filter(r=>r.outcome==='send'||r.outcome==='risky').map(r=>({...r,wave:r.outcome==='risky'?6:order[r.bucket]})).sort((a,b)=>a.wave-b.wave||(b.engaged||'').localeCompare(a.engaged||''));
 send.forEach((r,i)=>r.sendOrder=i+1);
 csv('send_eligible_by_member_id.csv',['sendOrder','wave','memberId','hintId','elationId','bucket','outcome','engaged'],send);
 const sup=[...res].filter(([,v])=>v.o==='suppress').map(([em,v])=>({docId:em,email:em,reason:'invalid_domain',source:'invite_precheck_mx',severity:'hard',detail:v.reason,memberIds:byEmail.get(em).map(c=>c.memberId||c.hintId).join('|')}));
 csv('IMPORT_emailSuppression_review.csv',['docId','email','reason','source','severity','detail','memberIds'],sup);
 const corr=rows.filter(r=>r.outcome==='correction').map(r=>({memberId:r.memberId,hintId:r.hintId,elationId:r.elationId,currentEmail:r.email,reason:r.reason,suggestedDomain:r.suggestion,status:'pending_review',source:'invite_precheck_2026-11-10'}));
 csv('IMPORT_inviteEmailCorrections_review.csv',['memberId','hintId','elationId','currentEmail','reason','suggestedDomain','status','source'],corr);
 sum.buckets=bucketCounts;sum.activeHint=active.length;sum.reasons={};rows.forEach(r=>{sum.reasons[r.reason]=(sum.reasons[r.reason]||0)+1});sum.suppressImport=sup.length;sum.correctionImport=corr.length;sum.sendList=send.length;
 sum.waves={};send.forEach(r=>sum.waves[r.wave]=(sum.waves[r.wave]||0)+1);
 fs.writeFileSync(`${OUT}/summary_counts.json`,JSON.stringify(sum,null,1));console.log(JSON.stringify(sum,null,1));
})().catch(e=>{console.error('FAIL',e.code||'',e.message);process.exit(1)});

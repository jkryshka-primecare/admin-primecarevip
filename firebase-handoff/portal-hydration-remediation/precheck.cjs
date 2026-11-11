const dns = require('node:dns').promises;
const COMMON = ['gmail.com','yahoo.com','hotmail.com','outlook.com','icloud.com','aol.com','live.com','msn.com','me.com','comcast.net','att.net','verizon.net','sbcglobal.net','protonmail.com','ymail.com','mac.com','cox.net','charter.net','bellsouth.net','earthlink.net','primecarevip.com','mail.com','gmx.com','zoho.com'];
const DISPOSABLE = new Set(['mailinator.com','guerrillamail.com','10minutemail.com','tempmail.com','temp-mail.org','yopmail.com','trashmail.com','sharklasers.com','getnada.com','dispostable.com','maildrop.cc','throwawaymail.com','fakeinbox.com','mintemail.com','emailondeck.com']);
const ROLE = new Set(['info','admin','support','office','contact','sales','billing','help','noreply','no-reply','hello','team','webmaster','postmaster','abuse','accounts','hr','reception','frontdesk','mail']);
function distance(a,b) {
  let row = Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++) { const next=[i]; for(let j=1;j<=b.length;j++) next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(a[i-1]===b[j-1]?0:1)); row=next; }
  return row[b.length];
}
function domainTypo(domain) {
  if(COMMON.includes(domain)) return '';
  return COMMON.find(c=>distance(domain,c)<=(c.length<=7?1:2) && Math.abs(domain.length-c.length)<=2) || '';
}
function validSyntax(email) {
  if(typeof email !== 'string' || email.length>254) return false;
  const parts=email.split('@');
  if(parts.length!==2 || parts[0].length>64 || parts[0].startsWith('.') || parts[0].endsWith('.') || parts[0].includes('..')) return false;
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(email);
}
function domainResolver(resolver=dns) {
  const cache=new Map();
  return domain=> {
    if(cache.has(domain)) return cache.get(domain);
    const promise=(async()=>{
      const query=async fn=> {try{return {values:await fn()};}catch(e){return {values:[],transient:!['ENOTFOUND','ENODATA','NXDOMAIN'].includes(e.code)};}};
      const mx=await query(()=>resolver.resolveMx(domain));
      if(mx.values.some(x=>x.exchange && x.exchange!=='.')) return 'MX';
      // RFC 7505 null MX is an explicit refusal, not an implicit A fallback.
      if(mx.values.length) return 'NONE';
      const a=await query(()=>resolver.resolve4(domain));
      if(a.values.length) return 'A';
      return mx.transient||a.transient?'LOOKUP_ERROR':'NONE';
    })();cache.set(domain,promise);return promise;
  };
}
async function classify(email,{suppressed=new Set(),bounced=new Set(),resolveDomain=domainResolver()}={}) {
  const e=String(email||'').trim().toLowerCase();
  if(suppressed.has(e)||bounced.has(e)) return {outcome:'suppress',reason:suppressed.has(e)?'ALREADY_SUPPRESSED':'KNOWN_BOUNCE'};
  if(!validSyntax(e)) return {outcome:'correction',reason:'BAD_SYNTAX'};
  const [local,domain]=e.split('@'); const suggestion=domainTypo(domain);
  if(suggestion) return {outcome:'correction',reason:'LIKELY_DOMAIN_TYPO',suggestion};
  if(ROLE.has(local.split('+')[0])||DISPOSABLE.has(domain)) return {outcome:'risky',reason:DISPOSABLE.has(domain)?'DISPOSABLE_DOMAIN':'ROLE_ADDRESS'};
  const result=await resolveDomain(domain);
  if(result==='NONE')return {outcome:'suppress',reason:'NO_MX_OR_A'};
  if(result==='LOOKUP_ERROR')return {outcome:'risky',reason:'DNS_LOOKUP_ERROR'};
  return {outcome:'send',reason:result};
}
module.exports={validSyntax,domainResolver,classify};
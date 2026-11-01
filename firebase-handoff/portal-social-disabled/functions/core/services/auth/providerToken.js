const crypto = require('node:crypto');
const config = {
  'google.com': { issuers: ['https://accounts.google.com', 'accounts.google.com'], url: 'https://www.googleapis.com/oauth2/v3/certs', env: 'SOCIAL_GOOGLE_CLIENT_IDS' },
  'apple.com': { issuers: ['https://appleid.apple.com'], url: 'https://appleid.apple.com/auth/keys', env: 'SOCIAL_APPLE_CLIENT_IDS' },
};
const cache = new Map();
function fail(reason) { const e = new Error(reason); e.reason = reason; throw e; }
async function verifyProviderIdToken(providerId, token, { nonceHash, fetchImpl = fetch, env = process.env, nowSec = Math.floor(Date.now()/1000) } = {}) {
  const c = config[providerId]; if (!c) fail('UNSUPPORTED_PROVIDER');
  if (!nonceHash) fail('MISSING_SERVER_NONCE');
  const audiences = String(env[c.env] || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!audiences.length) fail('PROVIDER_NOT_CONFIGURED');
  const parts = String(token || '').split('.'); if (parts.length !== 3 || String(token).length > 16384) fail('BAD_TOKEN');
  let h, p; try { h = JSON.parse(Buffer.from(parts[0], 'base64url')); p = JSON.parse(Buffer.from(parts[1], 'base64url')); } catch { fail('BAD_TOKEN'); }
  if (h.alg !== 'RS256' || typeof h.kid !== 'string') fail('BAD_TOKEN');
  let keys = cache.get(c.url);
  if (!keys || keys.expires <= Date.now() || !keys.keys.some(k => k.kid === h.kid)) {
    const r = await fetchImpl(c.url); if (!r.ok) fail('PROVIDER_UNAVAILABLE');
    const j = await r.json(); if (!Array.isArray(j.keys)) fail('PROVIDER_UNAVAILABLE');
    keys = { keys: j.keys, expires: Date.now()+3600000 }; cache.set(c.url, keys);
  }
  const k = keys.keys.find(k => k.kid === h.kid); if (!k || k.kty !== 'RSA') fail('BAD_TOKEN');
  if (!crypto.verify('RSA-SHA256', Buffer.from(parts[0]+'.'+parts[1]), crypto.createPublicKey({ key: k, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) fail('BAD_TOKEN');
  if (!c.issuers.includes(p.iss) || !(Array.isArray(p.aud) ? p.aud : [p.aud]).includes(audiences[0]) || (p.azp && !audiences.includes(p.azp))) fail('BAD_TOKEN');
  if (typeof p.exp !== 'number' || p.exp <= nowSec || typeof p.iat !== 'number' || p.iat > nowSec+60 || p.iat < nowSec-600) fail('TOKEN_EXPIRED');
  if (typeof p.sub !== 'string' || !p.sub || typeof p.nonce !== 'string' || crypto.createHash('sha256').update(p.nonce).digest('hex') !== nonceHash) fail('NONCE_MISMATCH');
  return { providerId, providerUid: p.sub, nonce: p.nonce, email: typeof p.email === 'string' ? p.email.toLowerCase() : null, emailVerified: p.email_verified === true || p.email_verified === 'true' };
}
module.exports = { verifyProviderIdToken, _jwksCache: cache };
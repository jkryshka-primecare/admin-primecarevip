const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { verifyProviderIdToken, _jwksCache } = require('../core/services/auth/providerToken');
const S = require('../core/services/auth/socialSession');
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const key = { ...publicKey.export({ format: 'jwk' }), kid: 'fixture' };
const now = 1900000000;
const encode = o => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(props = {}, signing = privateKey) {
  const body = encode({ alg: 'RS256', kid: 'fixture' })+'.'+encode({ iss: 'https://accounts.google.com', aud: 'test-client', sub: 'verified-subject', iat: now, exp: now+300, nonce: 'server-nonce', ...props });
  return body+'.'+crypto.sign('RSA-SHA256', Buffer.from(body), signing).toString('base64url');
}
const opts = { env: { SOCIAL_GOOGLE_CLIENT_IDS: 'test-client', SOCIAL_APPLE_CLIENT_IDS: 'test-apple' }, nowSec: now, nonceHash: S.digest('server-nonce'), fetchImpl: async () => ({ ok: true, json: async () => ({ keys: [key] }) }) };
test('accepts real RSA signature with expected server nonce', async () => {
  _jwksCache.clear(); assert.equal((await verifyProviderIdToken('google.com',token(),opts)).providerUid,'verified-subject');
});
for (const [label,props,reason] of [
  ['missing nonce',{ nonce: undefined },'NONCE_MISMATCH'], ['wrong nonce',{ nonce: 'different' },'NONCE_MISMATCH'],
  ['wrong issuer',{ iss: 'https://other.invalid' },'BAD_TOKEN'], ['wrong audience',{ aud: 'other-client' },'BAD_TOKEN'],
  ['expired',{ exp: now-1 },'TOKEN_EXPIRED'], ['old issuance',{ iat: now-601 },'TOKEN_EXPIRED'], ['future issuance',{ iat: now+61 },'TOKEN_EXPIRED'],
]) test(`rejects ${label}`, async () => assert.rejects(verifyProviderIdToken('google.com',token(props),opts),e => e.reason===reason));
test('rejects invalid signature', async () => {
  const other = crypto.generateKeyPairSync('rsa',{ modulusLength: 2048 });
  await assert.rejects(verifyProviderIdToken('google.com',token({},other.privateKey),opts),e=>e.reason==='BAD_TOKEN');
});
test('rejects absent server nonce before accepting a token', async () => assert.rejects(verifyProviderIdToken('google.com',token(),{ ...opts, nonceHash: undefined }),e=>e.reason==='MISSING_SERVER_NONCE'));
test('Apple signed token uses same server nonce contract', async () => assert.equal((await verifyProviderIdToken('apple.com',token({ iss:'https://appleid.apple.com', aud:'test-apple' }),opts)).providerId,'apple.com'));
test('browser proof, stages, expiry and subject cannot be substituted', () => {
  const proof = 'x'.repeat(43), id = { providerId: 'google.com', providerUid: 'one', nonce:'server-nonce' };
  const a = { proofHash:S.digest(proof), nonceHash:S.digest(id.nonce), providerId:id.providerId, identityKey:S.identityKey(id), expiresAtMs:500, stage:'code-required' };
  assert.doesNotThrow(()=>S.gate(a,proof,400,['code-required']));
  assert.throws(()=>S.gate(a,'y'.repeat(43),400,['code-required']),/INVALID_ATTEMPT/);
  assert.throws(()=>S.gate(a,proof,500,['code-required']),/ATTEMPT_EXPIRED/);
  assert.throws(()=>S.gate(a,proof,400,['new']),/ATTEMPT_USED/);
  assert.throws(()=>S.checkIdentity(a,{ ...id, providerUid:'two' }),/IDENTITY_MISMATCH/);
  assert.throws(()=>S.checkIdentity(a,{ ...id, nonce:'different' }),/NONCE_MISMATCH/);
});
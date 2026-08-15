// functions/middleware/requireAdminCaller.js
// Admin-plane caller gate. These endpoints are machine-to-machine: the only
// legitimate caller is the Prime Care OS backend, authenticating as the
// `portal-admin` service account with a Google OIDC identity token.
//
// This is the INNER gate. Cloud Functions IAM (roles/cloudfunctions.invoker on
// exactly these four functions) is the outer one. Both must pass.
//
// A patient's Firebase ID token is NOT accepted here — different issuer,
// different audience, and the caller email check would fail anyway.

const ALLOWED_CALLERS = [
  'portal-admin@prive-care-vip.iam.gserviceaccount.com',
];

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

let jwksCache = { keys: null, fetchedAt: 0 };
const JWKS_TTL_MS = 60 * 60 * 1000;

function b64urlToBuffer(part) {
  return Buffer.from(String(part).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

async function getJwks() {
  const now = Date.now();
  if (jwksCache.keys && now - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error(`jwks fetch failed: ${res.status}`);
  const body = await res.json();
  jwksCache = { keys: body.keys || [], fetchedAt: now };
  return jwksCache.keys;
}

function verifySignature(signingInput, signatureB64url, jwk) {
  const crypto = require('crypto');
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  return crypto.verify(
    'RSA-SHA256',
    Buffer.from(signingInput),
    key,
    b64urlToBuffer(signatureB64url),
  );
}

/**
 * Verify the Authorization bearer as a Google identity token issued to one of
 * ALLOWED_CALLERS, with `aud` matching this function's own URL.
 *
 * @returns {Promise<{ ok: true, caller: string } | { ok: false, status: number, reason: string }>}
 */
async function requireAdminCaller(req, expectedAudience) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return { ok: false, status: 401, reason: 'MISSING_TOKEN' };
  }
  const token = header.slice('Bearer '.length).trim();
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, status: 401, reason: 'MALFORMED_TOKEN' };

  let header0, claims;
  try {
    header0 = JSON.parse(b64urlToBuffer(parts[0]).toString('utf8'));
    claims = JSON.parse(b64urlToBuffer(parts[1]).toString('utf8'));
  } catch (e) {
    return { ok: false, status: 401, reason: 'MALFORMED_TOKEN' };
  }

  let keys;
  try {
    keys = await getJwks();
  } catch (e) {
    return { ok: false, status: 503, reason: 'KEY_FETCH_FAILED' };
  }
  const jwk = keys.find((k) => k.kid === header0.kid);
  if (!jwk) return { ok: false, status: 401, reason: 'UNKNOWN_KEY' };

  let valid = false;
  try {
    valid = verifySignature(`${parts[0]}.${parts[1]}`, parts[2], jwk);
  } catch (e) {
    valid = false;
  }
  if (!valid) return { ok: false, status: 401, reason: 'BAD_SIGNATURE' };

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp <= now) {
    return { ok: false, status: 401, reason: 'TOKEN_EXPIRED' };
  }
  if (!GOOGLE_ISSUERS.includes(claims.iss)) {
    return { ok: false, status: 401, reason: 'BAD_ISSUER' };
  }
  if (expectedAudience && claims.aud !== expectedAudience) {
    return { ok: false, status: 401, reason: 'BAD_AUDIENCE' };
  }
  const callerEmail = String(claims.email || '').toLowerCase();
  if (!claims.email_verified || !ALLOWED_CALLERS.includes(callerEmail)) {
    return { ok: false, status: 403, reason: 'CALLER_NOT_ALLOWED' };
  }

  return { ok: true, caller: callerEmail };
}

/** This function's own https URL, used as the identity-token audience. */
function selfAudience(req, functionName) {
  const region = process.env.FUNCTION_REGION || 'us-central1';
  const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'prive-care-vip';
  return `https://${region}-${project}.cloudfunctions.net/${functionName}`;
}

module.exports = { requireAdminCaller, selfAudience, ALLOWED_CALLERS };

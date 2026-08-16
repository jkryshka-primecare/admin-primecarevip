// functions/core/services/elation/resolvePatient.js
// Read-only Elation chart lookup used by adminProvisionPatients to turn a Hint
// member into an Elation patient id (which is the portal roster doc id).
//
// Safety posture:
//   - GET only. This module never creates, updates or deletes in Elation.
//   - It returns `confident: true` for exactly ONE surviving candidate. Any
//     ambiguity returns confident:false with the candidate count, and the
//     caller leaves the member unresolved for a human. Guessing here would
//     hand one member another person's chart.
//   - The match key is first name + last name + DOB, all three required. A
//     last name + DOB hit alone is NOT confident: a twin or same-DOB sibling
//     with no chart of their own would resolve onto their sibling's chart.
//   - Email is never a sole match key: families in this practice share one
//     email across parent and children. DOB is always in the key.
//
// Credentials (Secret Manager, or process.env in the emulator):
//   ELATION_CLIENT_ID, ELATION_CLIENT_SECRET, ELATION_USERNAME, ELATION_PASSWORD
// Base URL defaults to production; override with ELATION_BASE_URL for sandbox.

const BASE_URL = (process.env.ELATION_BASE_URL || 'https://app.elationemr.com/api/2.0').replace(
  /\/+$/,
  '',
);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const norm = (v) => String(v == null ? '' : v).trim();
const lower = (v) => norm(v).toLowerCase();

let secretsPromise = null;

/**
 * Reads the four Elation credentials. Prefers Secret Manager (how every other
 * handler in this repo reads secrets); falls back to env so the emulator and
 * local scripts work without GCP access.
 */
async function loadCredentials() {
  if (secretsPromise) return secretsPromise;
  secretsPromise = (async () => {
    const names = [
      'ELATION_CLIENT_ID',
      'ELATION_CLIENT_SECRET',
      'ELATION_USERNAME',
      'ELATION_PASSWORD',
    ];
    const out = {};
    const missing = [];

    let client = null;
    if (!process.env.FUNCTIONS_EMULATOR) {
      try {
        // eslint-disable-next-line global-require
        const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
        client = new SecretManagerServiceClient();
      } catch (e) {
        client = null;
      }
    }
    const project =
      process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'prive-care-vip';

    for (const name of names) {
      let value = norm(process.env[name]);
      if (!value && client) {
        try {
          const [v] = await client.accessSecretVersion({
            name: `projects/${project}/secrets/${name}/versions/latest`,
          });
          value = norm(v.payload && v.payload.data && v.payload.data.toString('utf8'));
        } catch (e) {
          value = '';
        }
      }
      if (!value) missing.push(name);
      out[name] = value;
    }

    if (missing.length) {
      const err = new Error(`ELATION_CREDENTIALS_MISSING: ${missing.join(', ')}`);
      err.code = 'ELATION_CREDENTIALS_MISSING';
      throw err;
    }
    return out;
  })();
  return secretsPromise;
}

// Token cache. Elation access tokens are long-lived; we refresh a minute early
// and re-mint once on a 401 rather than on every lookup, so a 300-member batch
// costs one token, not 300.
let tokenCache = { value: null, expiresAt: 0 };

async function getAccessToken(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && tokenCache.value && now < tokenCache.expiresAt) return tokenCache.value;

  const creds = await loadCredentials();
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: creds.ELATION_CLIENT_ID,
    client_secret: creds.ELATION_CLIENT_SECRET,
    username: creds.ELATION_USERNAME,
    password: creds.ELATION_PASSWORD,
  });

  const res = await fetch(`${BASE_URL}/oauth2/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`ELATION_AUTH_FAILED: ${res.status}`);
    err.code = 'ELATION_AUTH_FAILED';
    err.status = res.status;
    // Deliberately not attaching the response body — it can echo credentials.
    throw err;
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    const err = new Error('ELATION_AUTH_MALFORMED');
    err.code = 'ELATION_AUTH_MALFORMED';
    throw err;
  }
  const ttl = Number(json.expires_in) > 0 ? Number(json.expires_in) : 3600;
  tokenCache = { value: json.access_token, expiresAt: Date.now() + (ttl - 60) * 1000 };
  return tokenCache.value;
}

async function elationGet(path, params) {
  const url = new URL(`${BASE_URL}${path}`);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  });

  const attempt = async (token) =>
    fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });

  let res = await attempt(await getAccessToken());
  if (res.status === 401) res = await attempt(await getAccessToken(true));

  if (!res.ok) {
    const err = new Error(`ELATION_LOOKUP_FAILED: ${res.status}`);
    err.code = 'ELATION_LOOKUP_FAILED';
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function dobOf(patient) {
  // Elation returns `dob` as YYYY-MM-DD; tolerate a datetime just in case.
  return norm(patient && patient.dob).slice(0, 10);
}

/**
 * Resolve one Hint member to a single Elation chart.
 *
 * @param {{firstName:string,lastName:string,dob:string,email?:string|null}} member
 * @returns {Promise<{id:string|null, confident:boolean, reason:string, candidates:number}>}
 *
 * `confident: true` is returned ONLY when exactly one non-deleted chart matches
 * first name + last name + DOB (email may narrow further, never widen).
 * Two charts with identical first+last+DOB return AMBIGUOUS_MATCH. Everything
 * else — zero matches, several matches, an API failure — comes back
 * confident:false and the member stays unprovisioned.
 */
async function resolvePatient(member) {
  const firstName = lower(member && member.firstName);
  const lastName = lower(member && member.lastName);
  const dob = norm(member && member.dob).slice(0, 10);
  const email = lower(member && member.email);

  // First name is REQUIRED in the key. A single last-name + DOB hit is not
  // enough: a twin or same-DOB sibling who has no Elation chart yet would
  // otherwise resolve straight onto their sibling's chart.
  if (!firstName || !lastName || !ISO_DATE.test(dob)) {
    return { id: null, confident: false, reason: 'INCOMPLETE_IDENTITY', candidates: 0 };
  }

  let page;
  try {
    // Server-side filter on the two fields Elation indexes reliably. `limit`
    // is small on purpose: more than a handful of same-name-same-DOB charts is
    // a data problem for a human, not something to auto-pick from.
    page = await elationGet('/patients/', { last_name: member.lastName, dob, limit: 50 });
  } catch (e) {
    return {
      id: null,
      confident: false,
      reason: e.code || 'ELATION_LOOKUP_FAILED',
      candidates: 0,
    };
  }

  const all = Array.isArray(page && page.results) ? page.results : [];

  // Re-verify locally. Elation's filters have been permissive before; never
  // trust the server to have applied the key we care about.
  // The match key is first name + last name + DOB, all three enforced here.
  // A chart that agrees on last name and DOB but not first name is NOT a
  // match — it is a sibling/twin and is dropped, not narrowed to.
  let candidates = all.filter(
    (p) =>
      p &&
      !p.deleted_date &&
      lower(p.first_name) === firstName &&
      lower(p.last_name) === lastName &&
      dobOf(p) === dob,
  );

  if (candidates.length === 0) {
    return { id: null, confident: false, reason: 'NO_MATCH', candidates: 0 };
  }

  // Two charts agreeing on first + last + DOB are a duplicate-chart data
  // problem. We deliberately do NOT break the tie on email: a shared family
  // email is not identity evidence, and picking wrong hands one member
  // another person's chart. Route to a human instead.
  if (candidates.length > 1) {
    return {
      id: null,
      confident: false,
      reason: 'AMBIGUOUS_MATCH',
      candidates: candidates.length,
    };
  }


  return {
    id: String(candidates[0].id),
    confident: true,
    reason: 'SINGLE_MATCH',
    candidates: 1,
  };
}

module.exports = {
  resolvePatient,
  // adminProvisionPatients imports this name; keep both exports in sync.
  resolveElationPatient: resolvePatient,
  // exported for tests
  _internals: { elationGet, getAccessToken },
};

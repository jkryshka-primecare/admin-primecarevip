// functions/core/services/elation/resolvePatient.js
// Read-only Elation chart lookup used by adminProvisionPatients to turn a Hint
// member into an Elation patient id (which is the portal roster doc id).
//
// Auth: none of its own. This module reuses the repo's shared Elation client
// (functions/core/services/elation/client.js), which authenticates with
// grant_type: 'client_credentials' using ELATION_CLIENT_ID /
// ELATION_CLIENT_SECRET and scope 'apiv2'. There is deliberately no bespoke
// token cache, no password grant, and no ELATION_API_USERNAME /
// ELATION_API_PASSWORD here — one auth path for the whole repo.
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
//   - Email is never a match key or tiebreak: families in this practice share
//     one email across parent and children.

const { elationGet } = require('./client');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const norm = (v) => String(v == null ? '' : v).trim();
const lower = (v) => norm(v).toLowerCase();

function dobOf(patient) {
  // Elation returns `dob` as YYYY-MM-DD; tolerate a datetime just in case.
  return norm(patient && patient.dob).slice(0, 10);
}

/**
 * Map a shared-client error into a stable reason string. client.js throws a
 * typed error carrying `.reason` (e.g. ELATION_AUTH_FAILED,
 * ELATION_RATE_LIMITED) and `.elationStatus`; anything unrecognised falls back
 * to ELATION_LOOKUP_FAILED so the caller always gets a non-empty reason.
 */
function reasonFor(err) {
  if (!err) return 'ELATION_LOOKUP_FAILED';
  const reason = norm(err.reason) || norm(err.code);
  if (reason) return reason;
  if (err.elationStatus) return `ELATION_LOOKUP_FAILED_${err.elationStatus}`;
  return 'ELATION_LOOKUP_FAILED';
}

/**
 * Resolve one Hint member to a single Elation chart.
 *
 * @param {{firstName:string,lastName:string,dob:string,email?:string|null}} member
 * @returns {Promise<{id:string|null, confident:boolean, reason:string, candidates:number}>}
 *
 * `confident: true` is returned ONLY when exactly one non-deleted chart matches
 * first name + last name + DOB (email is never a tiebreak).
 * Two charts with identical first+last+DOB return AMBIGUOUS_MATCH. Everything
 * else — zero matches, several matches, an API failure — comes back
 * confident:false and the member stays unprovisioned.
 */
async function resolvePatient(member) {
  const firstName = lower(member && member.firstName);
  const lastName = lower(member && member.lastName);
  const dob = norm(member && member.dob).slice(0, 10);
  // Email is intentionally unused: it is never a match key or tiebreak here.

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
    return { id: null, confident: false, reason: reasonFor(e), candidates: 0 };
  }

  const all = Array.isArray(page && page.results) ? page.results : [];

  // Re-verify locally. Elation's filters have been permissive before; never
  // trust the server to have applied the key we care about.
  // The match key is first name + last name + DOB, all three enforced here.
  // A chart that agrees on last name and DOB but not first name is NOT a
  // match — it is a sibling/twin and is dropped, not narrowed to.
  const candidates = all.filter(
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
};

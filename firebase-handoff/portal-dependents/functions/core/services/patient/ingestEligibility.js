// functions/core/services/patient/ingestEligibility.js
// Release 2b · minor ingest — the ONE place that decides whether a report event
// may be persisted for a patient who never claimed a login.
//
// Before 2b the gate was D-111: `patients/<id>.status === 'active'` (the CLAIM
// lifecycle field, not `membershipStatus`). Minors never claim, so every report
// event for a child was dropped as `skip-non-active` and no metadata doc was
// ever written — guardian reads had nothing to authorize to.
//
// The exception is deliberately NARROW. It is not "sync unclaimed patients".
// BOTH conditions must hold:
//   1. `dependent.isMinor === true`   — the record is a minor TODAY. The
//      birthday sweep flips this to false at 18, so a converted-but-unclaimed
//      adult carrying a stale `active` guardian entry can never qualify.
//   2. at least one guardian entry with `status === 'active'` — someone is
//      actually authorized to read it.
//
// The D-068 allowlist gate (`ELATION_READ_ALLOWLIST`, checked by the caller via
// `isIngestAllowed`) stays in force and is checked FIRST. Minors are added to
// that allowlist deliberately, in the same batch as their `internalUid` mint.

/** True when the patient doc carries >= 1 guardian entry with status 'active'. */
function hasActiveGuardian(data) {
  const guardians = (data && Array.isArray(data.guardians)) ? data.guardians : [];
  return guardians.some((g) => g && g.status === 'active');
}

/** True when the record is flagged a minor right now (sweep-maintained). */
function isMinorRecord(data) {
  return Boolean(data && data.dependent && data.dependent.isMinor === true);
}

/**
 * `{ eligible, cohort, reason }` for a patient doc's data.
 * `reason` is a stable log tag, never PHI.
 */
function ingestEligibility(data) {
  if (!data) return { eligible: false, cohort: 'unknown', reason: 'no-patient-doc' };

  // Path 1 — the pre-existing, unchanged adult rule.
  if (data.status === 'active') {
    return { eligible: true, cohort: isMinorRecord(data) ? 'minor' : 'adult', reason: 'claimed-active' };
  }

  // Path 2 — the 2b exception. BOTH conditions, no shortcuts.
  const minor = isMinorRecord(data);
  const guarded = hasActiveGuardian(data);
  if (minor && guarded) {
    return { eligible: true, cohort: 'minor', reason: 'guardian-proxied-dependent' };
  }

  return {
    eligible: false,
    cohort: minor ? 'minor' : 'adult',
    reason: minor ? 'skip-minor-no-active-guardian' : 'skip-non-active',
  };
}

module.exports = { ingestEligibility, hasActiveGuardian, isMinorRecord };

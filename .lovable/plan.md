# Guardian model — inventory and phased build plan

Read-only review of what exists today, then a plan for the decided model: non-patient guardian
accounts, full access by default, a policy layer that can withhold categories, auto-revoke at 18,
and a consent-based transition to the new adult. Nothing was built or changed.

## What exists today

**Claim-time guardian bind — BUILT and unit-tested.** Runs at the end of activation. When a parent
activates their own account, it scans the minor cohort for children whose guardian entry names the
parent's chart, and stamps the parent's login id onto that entry. It never fails an activation, it
refuses links identified only by a shared email address, and it refuses any child whose access is
already paused for adult consent. Reusable as-is for parents who *are* patients; it cannot help a
guardian with no chart, because the whole match is chart-to-chart.

**The link data model.** The link lives on the *child's* record as a list of guardian entries
(guardian's chart id, email, login id, source, status active / pending-adult-consent / revoked, who
confirmed it and when). One guardian can appear on many children — the switcher collects them by
scanning the minor cohort. There is no separate grants collection. This shape survives the new
model; the only hole is that an entry today is keyed on the guardian's chart.

**Readiness classification — BUILT as an operator script, read-only.** It buckets every minor with
an active guardian link by whether that guardian could actually read anything at cutover: linked and
bound, resolvable now, parent has a chart but never activated, parent has an account but no chart,
or neither. Last run: 174 minors with an active link — 45 ready, 90 chart-but-never-activated,
38 neither, 1 account-without-chart. Under the decided model the 90 and the 38 stop being blocked by
"the parent needs their own chart", which is most of the value of this change.

**Account / auth — a login without a patient record is NOT possible today.** Activation starts from
a token that points at a roster record, requires that record to exist, and second-factors against
the date of birth on it. Everything downstream — the guardian check included — first resolves "the
caller's own chart" and refuses outright when there is none. A non-patient guardian therefore needs:
a record of their own that is explicitly *not* a patient, an activation path that does not demand an
Elation chart, and a guardian check that no longer requires the caller to own a chart. This is the
single biggest net-new piece.

**Clinical read resolution — proxy resolution exists, partially wired.** One shared resolver decides
whose chart a read is about: the caller's own unless they name a child and are authorized for that
child, and a named-but-unauthorized child returns "not available" rather than quietly serving the
caller's own chart. Every scoped answer echoes back whose chart it is so the app can verify.
Wired in: the patient record, labs, imaging, medical records, letters, and document downloads.
**Not wired in: medications, allergies, problems, appointments** — these are self-only today and
would ignore a child selection. Guardian reads are additionally behind a master switch plus a
named-account allowlist, both off, with an empty allowlist denying everyone.

**Age / DOB — already computed, and already drives a revoke.** An eighteenth-birthday calculation is
shared code, and a daily sweep flips the record to adult, moves every active guardian entry to
pending-adult-consent, and invites the new adult to their own account. The read check treats
pending-adult-consent exactly like absence, so access stops the same day. The decided auto-revoke is
therefore largely built; what is missing is a read-time age check so a stale record cannot outlive
the sweep.

**Consent capture — half-built.** A member-facing endpoint lets a newly-adult member turn each
paused guardian back on or revoke it, acting only on their own record and only on paused entries.
What does not exist: the guardian-submitted form carrying the new adult's email and mobile, the
outbound authorization request to that adult, and any identity proof on the adult before the
decision counts. Category policy does not exist anywhere — no state, age or record-category rules.

## Proposed phases

**Phase A — non-patient guardian accounts and full proxy access.**
Introduce a guardian account record that is explicitly not a patient, an invite and activation path
for it that does not require an Elation chart (second factor becomes something the guardian knows,
since there is no chart date of birth), and a guardian entry keyed on the guardian account rather
than a chart. Loosen the guardian check so a caller with no chart can still be authorized, while
keeping every existing refusal. Finish wiring the four unwired record types through the same shared
resolver. Keep the master switch and allowlist, and prove it on named test accounts first.

**Phase B — policy filter capability.** A single filter applied after the subject is resolved and
before anything is returned, keyed by state, the minor's age and the record category, shipping with
an empty rule set that allows everything. Rules are data, so legal can populate them without a code
change. It runs only on proxy reads, never on a member reading their own record.

**Phase C — age-18 auto-revoke hardening.** Keep the daily sweep as the primary mechanism, add an
age check at read time so a record the sweep has not reached yet still stops serving, and add a
report of minors approaching 18 so staff are never surprised.

**Phase D — transition and new-adult consent.** The guardian form capturing the new adult's email
and mobile, an authorization request to that adult, proof that the adult holds that address or
number before the answer counts, their own account creation, and their decision to continue or end
the former guardian's access — reusing the existing consent endpoint as the final write.

## Risks and things that need care

- **The proxy path is the whole attack surface.** It stays isolated by having exactly one resolver
  that every read calls, by refusing rather than falling back whenever a named child is not
  authorized, by answering "not available" instead of "forbidden" so nothing confirms a child
  exists, and by staying behind the switch and allowlist. The four unwired endpoints are the current
  inconsistency and should be closed in Phase A, not later.
- **Loosening the "caller must own a chart" rule** is the change most likely to open a hole — it is
  currently the fence that makes two blanks unable to match. Any replacement must reject empty and
  missing identifiers explicitly rather than by accident.
- **Category filtering is new PHI behaviour.** Shipping it allow-all keeps launch unchanged, but it
  must be impossible to bypass by calling a record type that forgot to apply it — hence one filter
  at one chokepoint.
- **Auto-revoke is irreversible-feeling to families.** The existing paused state is the right
  design: access stops, the record is preserved, and the adult can restore it.
- **Identity proof on the new adult** is the weak point of the transition — an email typo must not
  hand a stranger a chart.
- Two guardians on one child share one set of controls; per-guardian difference is expressed only by
  revoking one of them.

## Next step

Confirm the phase order and I will build Phase A on a branch, tested, nothing deployed.

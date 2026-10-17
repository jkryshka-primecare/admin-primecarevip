# Hint billing safety check (no charges)

Goal: make sure pharmacy billing to Hint is safe to use again, without creating, changing or voiding any real charge.

## 1. Read-only health check of the billing key
- Billing uses its own saved Hint key, separate from the key the live data screens use.
- Confirm that key is still saved, then make one read-only lookup to Hint to show it's accepted.
- If Hint rejects it, tell the user. Nothing else changes until they supply a fresh key.

## 2. Stop guessing which member to bill
- Today, when the name search finds several people and none match exactly, billing picks the first result.
- Change: bill automatically only when exactly one Hint member matches first name, last name and date of birth. Anything else sets the dispense to "needs match", and staff choose the member in the existing match window.
- The by-hand choice in the match window keeps working as it does now.

## 3. Make the live-data connection read-only
- Hint screens can only read. Any request that tries to change something is refused.
- Charging and retracting stay in their own dedicated features, unchanged.

## 4. Show what's waiting
- Read-only count of dispenses marked failed or pending, so you know what to retry once the key is confirmed.

## Not included
- No test charges, retries or voids against Hint.
- No new billing types.

## Technical details
- `hint-create-charge` uses `HINT_API_TOKEN`, while `hint-live` uses `HINT_PRACTICE_API_KEY`. Check that the secret exists, then GET `/provider/patients?limit=1`.
- In `selectHintPatient`, remove the name-only, DOB-only and `patientList[0]` fallbacks. Return null unless exactly one patient matches exact first + last + DOB. Return a new `ambiguous_match` failure code and handle it in the Dispense and PendingBillingPanel screens.
- In `hint-live`, reject any `method` other than GET with a 405.
- Run a SELECT that groups `dispense_records` by `hint_billing_status`.
- Add a unit test for the matching rule: one exact match bills, while zero or several matches don't.

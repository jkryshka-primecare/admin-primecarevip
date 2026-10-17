# Reuse the practice Hint key for pharmacy billing

## Why reusing it is low-risk
- The "Prime Care VIP OS" key, last used today, is the one this app already uses. Hint doesn't limit what a practice key can do, so that key can already create charges. Reusing it gives the app no new power.
- Charges can still only be sent from the pharmacy billing and retract buttons, and only by Pharmacy, Admin or Super Admin staff. The live Hint screens are now read-only.
- Trade-offs, all minor:
  - If the key is ever turned off or replaced, the Hint screens and billing both stop at once. The new-member automation in Google uses this same key too.
  - In Hint, billing activity will show under "Prime Care VIP OS" instead of under a separate billing label.
  - Turning off billing alone would mean removing the buttons, not turning off a key.
- Don't use "Grok Bot (read-only)" or "Hero" for this.

## Changes
1. Charge and retract use the saved practice key whenever no separate billing key is saved. Nothing new needs to be entered.
2. Make one read-only lookup to Hint to confirm the key is accepted. No charge is sent.
3. Billing gets ready for your first real dispense. You won't need to do anything else.

## Technical details
- In `hint-create-charge` and `hint-void-charge`, read the key as `HINT_API_TOKEN ?? HINT_PRACTICE_API_KEY`, trimmed. The base URL stays `https://api.hint.com/api/provider/...`, the same one `hint-live` uses.
- Redeploy both functions. Verify with a GET to `/provider/patients?limit=1` through `hint-live`, with no POST or DELETE.

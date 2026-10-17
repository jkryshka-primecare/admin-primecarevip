# Bring signed Elation prescriptions into Primecare VIP RX

## What I found
- Nothing in this app currently pulls prescriptions from Elation. The pharmacy queue is set up, but it has never received a single prescription. That's why the Test Kieffer script didn't appear.
- The "PCVIP" note rule you remember isn't anywhere in this app. It may have lived in an earlier tool. I'll rebuild it, adding HERO as a second program.

## How it will work
1. Every 5 minutes, the app checks Elation for newly signed prescriptions.
2. A script comes over only if its note to pharmacy contains **PCVIP** or **HERO**. Capital or lowercase letters both count. Scripts without either word are ignored.
3. Each script lands in the pharmacy queue with a **PCVIP** or **HERO** label. If the medication isn't in our inventory, it still shows up, flagged "Not in stock", so it can't be missed.
4. Dispensing:
   - **PCVIP**: priced from the inventory price list, removed from stock, and billed to the patient in Hint, the same as today.
   - **HERO**: removed from stock and recorded with all prices set to \$0. Nothing is sent to Hint, and it never shows in "Hint Invoices".
5. The same script is never brought in twice.
6. A "Check Elation now" button on the queue lets you pull right away instead of waiting.
7. To test, I'll pull your signed Test Kieffer script and confirm it shows up in the queue with the right label. I won't dispense or bill anything.

## Open item
- If a script's note says both PCVIP and HERO, it will be held as "Needs review" rather than guessed.

## Technical details
- Migration: add a `program` column (`pcvip` | `hero`) to `prescription_queue` and `dispense_records`, and a `not_in_inventory` flag on the queue. Add a small `elation_rx_sync_state` table that stores the last-checked time, with grants and RLS for pharmacy, admin and super admin.
- New edge function `elation-rx-sync`:
  - Uses the existing Elation OAuth secrets and reads prescriptions signed since the last cursor. I'll confirm the exact endpoint and the note field against the live Test Kieffer script first.
  - Matches PCVIP/HERO as whole words, inserts on conflict with `elation_prescription_id` doing nothing, matches inventory by NDC and then by name and strength, and moves the cursor only when the run succeeds.
  - Uses chart and prescription IDs only, never email matching.
- Scheduled every 5 minutes through the managed scheduling tool, which is 288 runs a day. A staff-triggered "sync now" calls the same function.
- Dispense page: when `program = 'hero'`, set unit and total price to 0, set `hint_billing_status = 'not_billable'`, and skip `hint-create-charge`. Exclude HERO from the Pending Billing panel.
- Save the PCVIP/HERO billing rule to project memory, and add tests for keyword matching and HERO zero-billing.

# Manual Pricing Entry — Plan

Add a manual way to enter pricing into the Cost Estimator, exposed via **four entry points** that all open the **same underlying form** (pre-filled differently). Provider name is the only truly required field, so partial provider records can be created and enriched over time.

## Fields collected (per your spec)

**Provider section**
- Provider name *(required)*
- Categories (specialty — multi-select; first one stored as `specialty_id`, additional saved as tags)
- Address: street, city, state, zip
- Phone
- Fax *(new column)*

**Pricing rows (repeatable, 0..N)**
For each row:
- CPT code (with lookup against `cpt_codes` to auto-fill description/category)
- Service name (auto-filled from CPT lookup, editable)
- Component (defaults to `cash`; dropdown: cash, gross, negotiated, min, max)
- Price (USD)

User can submit with zero pricing rows (creates/updates provider only). Any started row must have CPT + price to save.

## The four entry points

| # | Where | Pre-fills |
|---|---|---|
| a | **"Add Pricing Manually"** button — Estimator header, next to Import (admin only) | nothing |
| b | **4th tab "Manual Entry"** inside the existing Import Pricing dialog | nothing |
| c | **Inline "+ Add price"** on a `ServiceTable` row that has no price for current provider context | CPT code + service name locked |
| d | **"Paste rows" mode** — toggle inside the same form that swaps the row repeater for a textarea accepting tab/comma-separated `CPT, component, price` lines | provider section unchanged |

All four mount the same `<ManualPricingDialog />` with different initial props — no duplicated form logic.

## Database changes (one migration)

1. `ALTER TABLE providers`:
   - Drop NOT NULL on `specialty_id`, `city`, `state`, `phone` (so a name-only stub can be saved).
   - Add `fax text`.
   - Add `categories text[] not null default '{}'` (for multi-category tagging beyond primary specialty).
2. No changes to `services` or `service_prices` schema — manual rows reuse existing structure. New services created from manual entry get an auto-generated `id` like `MAN-<cpt>` if the CPT isn't already in `services`.
3. Manual price writes append to `price_audit_log` with `component='manual_entry'` source noted in `changed_by_name`, same as the existing admin price-edit path.

## Frontend work

- New `src/components/estimator/ManualPricingDialog.tsx` — the shared dialog with provider section + pricing-rows repeater + paste-mode toggle.
- New hook `src/hooks/useManualPricing.ts` — handles upsert provider → upsert services → upsert service_prices → audit log, all in one mutation with toast feedback.
- Header: add "Add Pricing Manually" button beside `ImportPricingDialog` in `EstimatorHome.tsx` (admin-gated like Import).
- `ImportPricingDialog.tsx`: add 4th tab "Manual Entry" that renders `ManualPricingDialog`'s body inline.
- `ServiceTable.tsx`: when a row has no price for the active provider context, render a subtle "+ Add price" link (admin only) that opens the dialog with CPT locked.

## Behavior details

- **Provider matching**: typeahead against existing providers by name; selecting one switches to "edit/append" mode (form pre-fills, new rows append).
- **CPT matching**: typeahead against `cpt_codes`; if not found, allow free entry and create a new `services` row on submit.
- **Validation**: provider name required; each pricing row needs CPT + numeric price > 0 OR be empty/removed before submit.
- **Audit**: every price written produces a `price_audit_log` entry tagged as manual.

## Out of scope (for this pass)

- No bulk CSV upload from the manual flow (already covered by File import).
- No edit-existing-price flow (already covered by the admin inline edit on ServiceTable).

---

Confirm and I'll switch to build mode and start with the migration.

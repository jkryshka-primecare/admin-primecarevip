# Stripe readiness — preliminary report (read-only, nothing changed)

## Bottom line
Prime Care OS has no Stripe payment processing. All money movement today goes through Hint. There is, however, one important head start: the member app's database already holds Stripe customer, subscription and invoice records, which this app can view read-only.

## What exists today

### 1. Hint is the billing engine
- Pharmacy charges: when a PCVIP prescription is dispensed, the app finds the patient in Hint and posts a charge to Hint. HERO prescriptions are $0 and never billed.
- Charge reversal: a void function undoes a Hint charge from pharmacy history.
- Duplicate protection: a dispense that already has a Hint charge is not billed twice; ambiguous patient matches stop for review.
- Billing rules live in one tested place (PCVIP vs HERO pricing).
- Pending Billing panel shows failed or waiting charges for staff follow-up.

### 2. Hint is also the membership record
- Read-only views of Hint patients, memberships, plans, subscriptions, invoices, revenue summaries and organizations (dashboards, insights, roster).
- Hint membership status is the source of truth for who is a member, which drives portal invites and roster checks.
- Connection health monitoring and alert emails for the Hint link.

### 3. Stripe data already exists — but only to view
- The member app stores Stripe-sourced records: billing accounts (with Stripe customer IDs), subscriptions, invoices and onboarding fees.
- Prime Care OS shows them on a patient's Membership tab and in the Member App Explorer. It cannot charge, refund or change anything in Stripe.
- No Stripe keys, checkout, webhooks or payment tables exist in this app.

### 4. Gap to flag
The Membership tab links a patient to their Stripe billing account by email. That conflicts with our rule never to match members by email. It is read-only, but it should switch to the patient record ID before Stripe becomes the system of record.

## What Hint does that we would need to replace
- Membership plans and pricing, enrollment and cancellation
- Recurring billing, invoices, failed-payment retries and dunning
- One-off charges (pharmacy, labs, fees) and refunds or voids
- Employer and organization billing, family and dependent accounts
- Card-on-file storage and member payment-method updates
- Revenue and membership reporting
- Membership status feeding portal access and invite eligibility

## How payments actually flow today (from you)
- Prime Care VIP has its own Stripe account.
- Hint is the subscription brain; it has never been the card processor.
- About 25% of members are still charged through Stripe; about 75% moved to Rainforest when Hint switched a year ago.
- Detaching from Hint means going back to Stripe directly, using your own account (not Lovable's built-in Stripe).

## What this means for a move
- The 25% on Stripe: customers and saved cards likely already sit in your Stripe account, so they may move with little member effort.
- The 75% on Rainforest: the hardest part. Saved cards would need a processor-to-processor card transfer from Rainforest to Stripe, or members re-enter cards. Confirming whether Rainforest supports that transfer is the first thing to ask.
- The Stripe records already in the member app likely reflect the 25% group. That needs confirming.

## Open questions
- Is the member app's Stripe data from your own Stripe account, written by Hint or by our member app?
- Will Rainforest export saved cards to Stripe, and on what terms?

## Suggested next steps (when you're ready)
1. Ask Rainforest about card export; inventory your Stripe account and the member app's billing writer.
2. Map each Hint function above to a Stripe feature or something we build.
3. Fix the email-based billing link to use patient record IDs.
4. Move pharmacy charges first (small, already well-guarded), then memberships.

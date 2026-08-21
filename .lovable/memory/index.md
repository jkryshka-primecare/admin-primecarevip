# Memory: index.md
Updated: just now

# Project Memory

## Core
Prime Care VIP brand: Midnight Care navy #04244C (primary), Pulse Blue/Bright Aqua #00B8FF (accent/CTA), Pure Calm #F5F4EE (bg), WellSpring green #00C853 (success), Pink #EB3774 (alert/destructive).
Light theme. Tinos serif for headings (h1-h4), Roboto sans for body, Roboto Mono for data. Tone: warm, confident, human — not cyberpunk/sterile.
All colors via semantic tokens in index.css (HSL). Never hardcode hex/Tailwind color classes in components.
Logo at src/assets/primecare-logo.jpg — used in Sidebar header on white card.
Lovable Cloud (Supabase) backend. Sandbox edge functions: hint-sandbox, elation-sandbox, fhir-medications-sandbox, fhir-labs-sandbox.
All live integrations (Elation, Hint, Firestore) are READ-ONLY. Never create/update/delete upstream records without explicit per-action user approval.
Elation patient ID is the only unique patient identifier (families share email/phone).
PHI/HIPAA hardening: app requires login (email+password or Google SSO). Roles in user_roles table (admin/clinician/staff/pending) — NEVER store roles on profiles. New signups land in 'pending' until admin promotion. All PHI edge functions call requireStaff() + logPhiAccess() from supabase/functions/_shared/auth.ts. 15-min idle auto-logout. PHI acknowledgment modal on first login (profiles.phi_acknowledged_at). Audit log: phi_access_log (admin-read, no client writes).

## Memories
- [Live API safety](mem://live-api-safety) — read-only rule for Elation/Hint/Firestore production APIs
- [Patient identity](mem://patient-identity) — Elation patient ID is the cross-system join key
- [Firestore bridge](mem://firestore-bridge) — read-only Firestore edge function + collections whitelist
- [Portal WIF bridge account](mem://portal-bridge-account) — machine account sub/email, no-role rule, password rotation policy
- [Portal artifact read contract](mem://portal-artifact-contract) — 300s TTL, `preparing` state, absence-not-forbidden; 2b red-team follow-up on reference-ownership
- [Portal access retention](mem://portal-access-retention) — former/lapsed members keep read-only portal access; membership never gates the read path



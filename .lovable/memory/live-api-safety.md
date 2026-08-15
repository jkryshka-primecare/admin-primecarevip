---
name: Live production API safety rule
description: Never write/delete against Elation, Hint, or Firestore without explicit per-action user approval; all integrations are read-only by default
type: constraint
---

Elation, Hint, and Firebase/Firestore in this project are LIVE production systems holding real patient records.

- All integration proxies are read-only. No POST/PATCH/PUT/DELETE to these upstreams without explicit per-action approval from the user first.
- `firestore-bridge` implements only `get` and `runQuery`. Do not add write verbs.
- `elation-live` and `hint-live` stay GET-only for record data. Existing billing charge functions (`hint-create-charge`, `hint-void-charge`) are the only sanctioned writes and are user-initiated.
- Never run destructive testing against production. Verify with reads only.

**Why:** Unintended mutations would alter real patient/member records — HIPAA and patient-safety risk.

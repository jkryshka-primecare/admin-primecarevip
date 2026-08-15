---
name: Patient identity key
description: Elation patient ID is the only unique patient identifier across Elation, Firestore, and Hint
type: feature
---

Use the **Elation patient ID** as the join key for patient records everywhere.

Email and phone are NOT unique — young children in the practice share the same email and phone number as their adult parents.

Firestore keys member documents by Elation patient ID (`patients/{elationPatientId}`), so Firestore ↔ Elation joins need no mapping table. Hint records are matched separately and may be absent.

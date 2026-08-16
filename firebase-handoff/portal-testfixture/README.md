# Rows 6–7 fixture: synced lab artifact + a second lab item (member 816455979040769)

Script: `seed-test-lab-artifacts.js` — copy into the portal repo's `scripts/` and run from
the repo root (needs `firebase-admin` + ADC). Dry run by default; `--apply` writes.

## How artifacts resolve (answers ask #1)

`getLabs` artifact mode is **Storage-only** — it never calls Elation and there is **no
`hydrationStatus` gate**. Given `reportId` in the POST body it:

1. suspension check → module check (`labs`);
2. `filterHidden(portalAccess, 'labs', [{id: reportId}])` — a hidden item returns
   **404 `ARTIFACT_NOT_SYNCED`** *before* any Storage access (row 7's expected result, and
   deliberately identical to "not synced" so nothing leaks);
3. `file.exists()` on **`elation-artifacts/<firebaseUid-lowercase>/<reportId>/report.pdf`**
   in bucket **`prive-care-vip.firebasestorage.app`** — missing object → the same 404;
4. v4 signed URL, `action: 'read'`, **30-min TTL** → `{ signedUrl, expiresAt, contentType }`.

So the 404 you hit means the object doesn't exist. Two facts that matter:

- The uid in the path is the **lowercase** `firebaseUid` (`neozyhs59ue0vooapsrocygo1ah3`),
  not `authUid` (D-112).
- The **write** bucket must be pinned explicitly. `index.js` sets no default
  `storageBucket`, so `admin.storage().bucket()` writes somewhere the read CFs never look —
  that was #379. The script pins it.

**Production path first:** `backfillElationReports` (#372/D-119) fetches
`GET /reports/<id>/printable` and uploads to exactly that path, flipping `hasArtifact` to
Storage-truth. If the test member's real lab report actually has a printable in Elation,
re-run the backfill runner for `816455979040769` and you get a genuine artifact with no
hand-seeding. It skips unclaimed patients — this member is claimed, so it will upload.
The 404 you're seeing means either the backfill hasn't been run for this id or that report
has no printable; the script below covers the second case.

## What the script does (answers ask #2)

1. For every existing `category=='lab'`, `deleted==false` doc on the member with no object
   in Storage: uploads a valid 1-page dummy PDF (`%PDF-1.4`, renders in-browser, watermarked
   "TEST FIXTURE") and sets `hasArtifact: true`.
2. Creates a second lab doc `labs/SMOKE-LAB-2` (CBC with Differential, 3-row `results` grid,
   today's dates, `deleted:false`, `hasArtifact:true`) plus its PDF — the sibling row 7
   needs to prove hiding one item leaves the other untouched.
3. Re-reads and prints `hasArtifact` vs `pdfInStorage` per doc, exiting 2 on any mismatch.

`--cleanup --apply` removes `SMOKE-LAB-2` and its PDF when the smoke test is done.

Safety, same pattern as the reset script: patient id, uid and synthetic doc id are pinned
constants, not argv; it aborts unless the roster doc carries the pinned uid **and**
`patient-test-1@primecarevip.com`. Real Elation report ids are numeric and stores are
`merge:false` store-once by `reportId`, so `SMOKE-LAB-2` can't collide with the poller or a
backfill re-run.

## Row 6–7 sequence once seeded

| Step | Action | Expected |
|---|---|---|
| 6 | Member opens either lab's attachment | 200 `{ signedUrl, expiresAt }`, PDF renders; `expiresAt` ≈ now + 30 min; `phi_access_log` gets `own_lab_artifact_viewed` with the `reportId` |
| 7 | OS panel: hide `SMOKE-LAB-2` | list drops it, the other lab still listed; artifact-mode call for `SMOKE-LAB-2` → 404 `ARTIFACT_NOT_SYNCED`; artifact for the sibling still 200 |
| 7b | Unhide | both back in the list, both artifacts 200 |

Note for row 7: any signed URL issued **before** the hide keeps working until it expires —
bounded at 30 minutes, as established. Test the suppression with a fresh call, not a
previously opened tab.

## On using a different member

Not recommended. Every other member with synced artifacts is a real patient, and rows 2–3
need a staff-controlled inbox. `816455979040769` + `patient-test-1@primecarevip.com` remains
the only fixture that satisfies both; seeding it keeps the whole matrix on one account.

## Approval

These are **writes to production Firestore and Storage** scoped to the synthetic member.
Per the standing rule I have not run anything — the script is dry-run by default and is
yours to execute.

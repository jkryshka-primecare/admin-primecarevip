# CRM separate-database migration — pre-read (for Greg)

Goal: do the `crmdb` migration once. Authority: INTEGRATION-CONTRACT §6 (D-320).
Nothing here authorizes a merge or a deploy. Items marked **[Greg to confirm]**
are inside CRM function code, which is not visible from the portal side.

Checked against `primecarevip/prime-care-vip-app-v2` @ main on 2026-09-28.

---

## 0. Ground truth (portal repo, verified today)

| Fact | Value | Source |
| --- | --- | --- |
| Database id | **`crmdb`** (not `crm` — the earlier draft was wrong) | created DB + IAM condition |
| `firebase-admin` | `^12.0.0`, **12.7.0 resolved** | `functions/package-lock.json` |
| `firebase-functions` | `^5.0.0`, **5.1.1 resolved** | `functions/package-lock.json` |
| `@google-cloud/firestore` | 7.11.6 (transitive) | lockfile |
| Node | `22` | `functions/package.json` engines |
| `firebase.json` → `functions` | array, one entry: `source: "functions"`, `codebase: "portal-functions"` | firebase.json |
| `firebase.json` → `firestore` | single object (default DB only) | firebase.json |
| `crm-functions/` directory | **does not exist in the portal repo** | repo root listing |
| CI `firebase-tools` | **unpinned** (`pnpm add -g firebase-tools` = latest) | deploy-production.yml:111 |
| CI functions deploy | **unscoped** `--only functions` (lines 187, 194) | deploy-production.yml |
| CI rules/indexes deploy | `--only firestore:rules,storage` / `--only firestore:indexes` | deploy-production.yml:142,152 |
| Runtime SA for CRM | `crm-runtime@prive-care-vip.iam.gserviceaccount.com` | IAM test 2026-09-28 |
| IAM isolation | `roles/datastore.user` conditioned on `crmdb`: 200/200/200 on crmdb, 403/403 on (default) | validated |
| App Check | not enforced project-wide; stays off | — |

---

## 1. Single-accessor pattern — accurate, one fix

Accurate on the pinned SDK: `getFirestore(app, databaseId)` exists in firebase-admin
since 11.x and is present in the resolved 12.7.0. Fix: the id is `crmdb`.

```js
// [Greg to confirm path] e.g. crm-functions/core/db.js
const { getApp, initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const CRM_DATABASE_ID = 'crmdb';
const app = getApps().length ? getApp() : initializeApp();
const db = getFirestore(app, CRM_DATABASE_ID);   // memoized by the SDK

function crmDb() { return db; }
module.exports = { crmDb, CRM_DATABASE_ID };
```

Rules unchanged: no other `getFirestore(` / `admin.firestore(` in CRM code (CI grep);
portal facts come via `portalGetAppointments` (Model B), never direct reads.
The IAM condition is the real boundary (proven above); `crmDb()` is addressing only.
A stray default-DB handle under `crm-runtime` now fails with 403 rather than leaking.

## 2. Gen-2 triggers — accurate, one fix

The `{ document, database }` object form on `firebase-functions/v2/firestore`
`onDocument*` needs ≥ 4.3.0; resolved 5.1.1 supports it. Fix: `database: 'crmdb'`.

```js
exports.onLeadWritten = onDocumentWritten(
  { database: 'crmdb', document: 'crm_leads/{leadId}', region: 'us-central1', retry: false },
  async (event) => { /* ... */ }
);
```

- Omitting `database` targets `(default)` and the trigger silently never fires.
- Gen-1 `functions.firestore.document()` cannot target a named DB.
- Region must match the `crmdb` location (`nam5` → `us-central1`).
- `crmdb` id and location are immutable.

### Pins

| Package | Pin |
| --- | --- |
| `firebase-admin` | `^12.7.0` (match portal) |
| `firebase-functions` | `^5.1.1` (match portal; no v6 unilaterally) |
| `firebase-tools` | `>= 13`, exact patch pinned in CI — **portal CI must pin too** (currently latest) |
| Node | `22` |

## 3. Service account

Not a `firebase.json` field. It goes in function code:

```js
// gen-2 (recommended, one place for all CRM functions)
const { setGlobalOptions } = require('firebase-functions/v2');
setGlobalOptions({
  region: 'us-central1',
  serviceAccount: 'crm-runtime@prive-care-vip.iam.gserviceaccount.com',
});

// gen-1 HTTP functions, if any remain
functions.runWith({ serviceAccount: 'crm-runtime@prive-care-vip.iam.gserviceaccount.com' })
```

**[Greg to confirm]** every one of the ~35 functions picks this up (gen-1 functions do
not read `setGlobalOptions`). The deploying identity needs `iam.serviceAccountUser`
on `crm-runtime`.

## 4. Source-dir topology and deploy invocation

**Today the CRM source is not in the portal repo.** Where it lives is **[Greg to confirm]**.
Two workable shapes; both need a codebase name that never collides with `portal-functions`.

**Codebase declaration** (whichever repo holds the CRM `firebase.json`):

```jsonc
"functions": [
  { "source": "crm-functions", "codebase": "crm-functions",
    "ignore": ["node_modules", ".git", "test", "**/*.test.js"] }
]
```

- Firebase deletes only functions **within the codebase being deployed**. As long as CRM
  functions are deployed under codebase `crm-functions`, portal deploys (`portal-functions`)
  cannot delete them, and vice versa.
- If CRM functions were ever deployed with no codebase (implicit `default`), they must be
  redeployed under `crm-functions` once; **[Greg to confirm]** the current codebase label.

**The only deploy commands CRM should run** (never bare `firebase deploy`):

```bash
firebase deploy --only functions:crm-functions --project prive-care-vip
# single function:
firebase deploy --only functions:crm-functions:onLeadWritten --project prive-care-vip
```

`--only functions:<codebase>` scopes create/update/delete to that codebase. A bare
`firebase deploy` or `--only functions` from a directory whose `firebase.json` also holds
hosting/firestore config is what caused the accidental full deploy. Recommend a
`package.json` script (`"deploy": "firebase deploy --only functions:crm-functions"`) and no
other deploy path.

**Portal side (our PR):** CI changes `--only functions` → `--only functions:portal-functions`,
so the portal can never touch another codebase either.

Items inside CRM code: `CRM_DATABASE_ID` / accessor location, `index.js` export mapping,
gen split per function — **[Greg to confirm]**.

## 5. Rules and indexes for `crmdb` (portal PR — staged)

`crmdb` is backend-only; client access denied. `crm.firestore.rules` (committed):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if false; }
  }
}
```

`firebase.json` after the PR:

```jsonc
"firestore": [
  { "database": "(default)", "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
  { "database": "crmdb", "rules": "crm.firestore.rules", "indexes": "crm.firestore.indexes.json" }
]
```

CI, both directions scoped (quote the parentheses):

```bash
firebase deploy --only 'firestore:(default)',storage ...   # portal rules+indexes, default only
firebase deploy --only firestore:crmdb ...                  # CRM rules+indexes
```

Why: with the array form, today's `firestore:rules` / `firestore:indexes` would push to
**both** databases. The exact target spelling is verified against the pinned CLI in the
emulator and a CI dry run before merge; if the CLI wants another form, it's shown first.

Waiting on: `crm.firestore.indexes.json` from Greg — wired in the same PR.

## 6. Order of operations

1. Done: `crmdb` created, `crm-runtime` conditioned grant, isolation proven.
2. Greg: `db.js` accessor, `database: 'crmdb'` on every trigger, `serviceAccount` on every
   function, codebase `crm-functions`, deploy script scoped to `functions:crm-functions`.
3. Greg: redeploy the ~35 functions under `crm-runtime` (admin SDK bypasses rules — not
   blocked on step 4).
4. Portal PR: rules + indexes wiring, both CI targets scoped, firebase-tools pinned,
   functions deploy scoped to `portal-functions`.
5. Verify one gen-2 trigger fires on a `crmdb` write before porting the rest.

Still open: the four public PHI writers (source or `crmDb()` fence); appointment sync
build unauthorized; `crmSetUserRole` hard allowlist + audit blocker.

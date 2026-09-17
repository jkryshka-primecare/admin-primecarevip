# CRM separate-database migration — pre-read (spec only, nothing built)

Audience: Greg / CRM team. Goal: do the `crm` Firestore database migration **once**,
with no second pass. Three answers below: the single accessor, the gen-2 trigger +
version pins, and the deploy topology (including the source-dir question).

Authority: INTEGRATION-CONTRACT v1.62 §6 (D-320). Nothing here authorizes a merge or a deploy.

---

## 0. Ground truth from the portal repo (today)

| Fact | Value |
| --- | --- |
| `functions/package.json` | `firebase-admin ^12.0.0`, `firebase-functions ^5.0.0`, Node 22 |
| `firebase.json` → `functions` | already an **array**, one entry: `source: "functions"`, `codebase: "portal-functions"` |
| `firebase.json` → `firestore` | still a **single object** (default database only) |
| Portal function generation | gen-1 `https.onRequest` throughout; no gen-2 functions exist yet |
| App Check | not enabled anywhere — do not turn on project-level enforcement |

The CRM migration changes exactly two shapes in `firebase.json` (§3) and adds zero
portal runtime code.

---

## 1. Single-accessor pattern

One module, one export, used by **every** CRM function. No `getFirestore()` call
anywhere else in `crm-functions/`, no `admin.firestore()`, ever.

```js
// crm-functions/core/db.js
const { getApp, initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const CRM_DATABASE_ID = 'crm';

const app = getApps().length ? getApp() : initializeApp();

// Bound once at module load. getFirestore(app, id) is memoized by the SDK,
// so repeated requires return the same instance.
const db = getFirestore(app, CRM_DATABASE_ID);

/** The ONLY Firestore handle CRM code may use. */
function crmDb() {
  return db;
}

module.exports = { crmDb, CRM_DATABASE_ID };
```

Rules of use:

- Callers do `const { crmDb } = require('./core/db'); await crmDb().collection('crm_leads')...`
- `crmDb()` is an **addressing layer only** — it no longer carries the `crm_` prefix
  convention as a safety property. Collection names inside the `crm` database do not
  need the prefix, but keep it for one release so audit greps stay stable.
- CRM functions must **never** construct a default-database handle. If a CRM function
  legitimately needs a portal fact (patient identity, appointment fact), it calls the
  portal's service-to-service endpoint (`portalGetAppointments`, Model B, contract §6.3) —
  it does not read our data directly.
- Enforce with one lint/CI grep in the CRM codebase:
  `rg -n "getFirestore\(|admin\.firestore\(" crm-functions --glob '!core/db.js'` must return nothing.

Emulator note: `getFirestore(app, 'crm')` works against the emulator; declare the named
database in `firebase.json` (§3) so `firebase emulators:start` provisions it.

---

## 2. Gen-2 triggers against a named database

Firestore triggers default to `(default)`. A trigger with no `database` option will
**silently never fire** for `crm` documents — this is the single most likely way to
have to redo the migration. Every CRM Firestore trigger declares the database explicitly.

```js
// crm-functions/triggers/onLeadWritten.js
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');
const { crmDb, CRM_DATABASE_ID } = require('../core/db');

setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

exports.onLeadWritten = onDocumentWritten(
  {
    database: CRM_DATABASE_ID,     // REQUIRED — omitting it targets (default)
    document: 'crm_leads/{leadId}',
    region: 'us-central1',         // must match the database's location
    retry: false,
  },
  async (event) => {
    const after = event.data?.after?.data();
    if (!after) return;            // delete
    await crmDb().collection('crm_lead_audit').add({ /* ... */ });
  }
);
```

Constraints to design against now, not later:

- **Location is immutable.** Create the `crm` database in the same location as the
  default database (`nam5` / us-central) and deploy triggers to the matching region.
  Changing it later means creating a new database and re-migrating.
- **Database id is immutable.** `crm` is final; it is written into IAM conditions.
- Gen-1 `functions.firestore.document()` **cannot** target a named database. Any CRM
  Firestore trigger must be gen-2. Their HTTP endpoints may stay gen-1 if they prefer,
  but mixing is fine — codebases are per-source-dir, not per-generation.
- `event.database` is on the payload; assert it equals `crm` in a defensive guard if
  they want belt-and-braces.

### Versions to pin (CRM `crm-functions/package.json`)

| Package | Pin | Why this floor |
| --- | --- | --- |
| `firebase-admin` | `^12.0.0` (12.7+ preferred) | `getFirestore(app, databaseId)` lands in 12.0.0. Matches the portal codebase — keep the majors aligned so a shared Node 22 runtime behaves identically. |
| `firebase-functions` | `^5.0.0` (5.1+ preferred) | `database` option on v2 Firestore triggers requires ≥ 4.3.0; v5 is what the portal is on. Do **not** go to v6 unilaterally — a major split across codebases in one repo is a future foot-gun. |
| `firebase-tools` (CI + dev) | `>= 13.0.0` | Named-database deploy targets and per-database rules/index deploys need 13.x. Pin the exact patch in CI. |
| Node engine | `22` | Must match the portal's `engines.node`. |

`@google-cloud/firestore` is transitive — do not add it directly.

---

## 3. Deploy topology — answering the source-dir question

**Answer: single-source deploy. The ~35 CRM functions live in the portal repo, in a
sibling top-level directory `crm-functions/`, with their own `package.json` and their
own `node_modules`. The `firebase.json` codebase entry references that local path.**

A codebase entry's `source` is a path resolved relative to `firebase.json`, inside the
same repo and the same deploy. It cannot point at another repository, a git URL, or a
path outside the project root. There is no cross-repo codebase mechanism in the Firebase
CLI. So the choice is not "our repo vs theirs" — it is "one repo" or "two Firebase
projects", and we already ruled out the latter.

```
prime-care-vip-app-v2/
├── firebase.json
├── firestore.rules            # portal-owned, default DB
├── firestore.indexes.json     # portal-owned, default DB
├── firestore.crm.rules        # CRM-authored, portal-reviewed
├── firestore.crm.indexes.json
├── functions/                 # codebase: portal-functions  (unchanged)
│   ├── package.json
│   └── index.js
└── crm-functions/             # codebase: crm-functions      (NEW, CRM-owned)
    ├── package.json           # own deps, own node_modules
    ├── index.js               # exports all ~35
    ├── core/db.js             # the single accessor (§1)
    └── test/
```

`firebase.json` after the migration — the two shape changes:

```jsonc
{
  "firestore": [
    {
      "rules": "firestore.rules",
      "indexes": "firestore.indexes.json"
    },
    {
      "database": "crm",
      "rules": "firestore.crm.rules",
      "indexes": "firestore.crm.indexes.json"
    }
  ],
  "functions": [
    {
      "source": "functions",
      "codebase": "portal-functions",
      "ignore": ["node_modules", ".git", "test", "**/*.test.js"]
    },
    {
      "source": "crm-functions",
      "codebase": "crm-functions",
      "ignore": ["node_modules", ".git", "test", "**/*.test.js"]
    }
  ]
}
```

Why this shape matters operationally:

- **The codebase entry is what stops mutual deletion.** Without the second `functions`
  entry, a routine portal deploy sees 35 unrecognized functions in the project and
  deletes them. This entry must land in the **same PR** as the CRM's first function code —
  never after. (Same point as §5 of the handoff review.)
- Targeted deploys: `firebase deploy --only functions:crm-functions` and
  `--only functions:portal-functions` become independent. CI should use the targeted
  form on both sides so neither team can blast the other.
- Rules/indexes deploy per database: `firebase deploy --only firestore:crm`. The portal's
  default-DB rules stay on `firebase deploy --only firestore` semantics with the array form
  — verify this in staging on the pinned CLI version before the first production run.
- `crm-functions/` is CRM-owned by CODEOWNERS; `functions/`, `firestore.rules`,
  `storage.rules` and `firebase.json` itself stay portal-owned (portal review required).

### Database + IAM provisioning (one-time, before the first deploy)

1. Create the database: `gcloud firestore databases create --database=crm --location=nam5 --type=firestore-native`
2. Grant the CRM function service account `roles/datastore.user` **conditioned** on
   `resource.name.startsWith('projects/<project>/databases/crm')`.
3. Do **not** grant that service account access to `(default)`. The IAM condition is the
   real containment boundary; `crmDb()` is only addressing.
4. Portal function service accounts get no grant on `crm` at all.

---

## 4. Order of operations (so it's done once)

1. Create the `crm` database + IAM conditions (§3) — infra only, no code.
2. One PR into the portal repo: `crm-functions/` source dir with `core/db.js`, the
   `firebase.json` array shapes, `firestore.crm.rules`, `firestore.crm.indexes.json`,
   CODEOWNERS, and CI targeted-deploy commands. This PR must also carry the §0 blocker
   fix (`crmSetUserRole` hard allowlist `['crm_admin','crm_super_admin']` + role-change audit)
   from the handoff review.
3. Deploy `--only firestore:crm` then `--only functions:crm-functions`, in that order.
4. Verify one gen-2 trigger actually fires on a `crm` write before porting the rest —
   this is the check that catches a missing `database` option while it costs an hour.

## 5. Still open (not answered here)

- §4 of the handoff review: the four public PHI writers — source or a `crmDb()` fence.
- Appointment sync scope (~5.5 days) remains unauthorized; Model B contract shape is
  written but no build is approved.
- App Check: in-function only. Project-level enforcement stays off until both portal
  web apps attest.

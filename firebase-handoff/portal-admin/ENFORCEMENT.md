# Enforcement patches for the read endpoints

Visibility set from Prime Care OS is only real when the PHI read endpoints
honour it. Hiding in the UI alone is not a control — the data still crosses
the wire. Apply this to every `get*` handler.

## Pattern

Applies to every list handler in the table below. **`getMyPatientRecord` is the
one deliberate exception** — see its section at the bottom.


Each handler already runs, in this order: `verifyPatientToken` → reject the
`unauthenticated` sentinel ("Guard B") → **`resolvePatientForCaller(uid)`**
(from `core/services/elation/resolvePatientForCaller`; the returned doc's `.id`
is the `elationPatientId`) → the D-068 `ELATION_READ_ALLOWLIST` gate →
audit-first write to `phi_access_log` → the Elation/Storage read.

Insert the guard **after the audit-first write and before the Elation read**,
so every attempt — including a denial — is still audited:

```js
const {
  getPortalAccess, assertNotSuspended, isModuleVisible, filterHidden,
} = require('./core/services/patient/portalAccess');

// Fail CLOSED: a suspended member gets nothing, and a read error here denies.
try {
  await assertNotSuspended(elationPatientId);
} catch (err) {
  if (err.portalReason === 'ACCESS_SUSPENDED') {
    return jsonError(res, 403, 'PERMISSION_DENIED', 'ACCESS_SUSPENDED',
      'Portal access for this account is currently paused. Please contact our office.');
  }
  return jsonError(res, 503, 'UNAVAILABLE', 'ACCESS_CHECK_FAILED');
}

// Fail OPEN on visibility. getPortalAccess never throws — it catches its own
// Firestore errors and returns the all-visible default — so no try/catch here.
const access = await getPortalAccess(elationPatientId);
if (!isModuleVisible(access, 'labs')) {
  return res.status(200).json({ items: [], moduleUnavailable: true });
}
```

`assertNotSuspended` and `getPortalAccess` each read the same
`portalAccess/{elationPatientId}` doc. If you prefer one read per request, call
`getPortalAccess` first and check `access.status === 'suspended'` yourself —
but then you lose the fail-closed behaviour on a Firestore error, so only do it
if you also treat a read error as a denial.

Then filter the result set right before responding, using **that handler's own
response variable and shape** — the list handlers return `{ items }`, but
`getMyPatientRecord` returns a `payload` object, so do not assume `{ items }`
everywhere:

```js
const visible = filterHidden(access, 'labs', items, (it) => it.id);
return res.status(200).json({ items: visible });
```

## Module key per handler

| Handler | module key | id used for `hiddenItems` |
| --- | --- | --- |
| `getLabs` | `labs` | report/result id |
| `getImaging` | `imaging` | report id |
| `getMedications` | `medications` | medication id |
| `getLetters` | `records` | letter id |
| `getMedicalRecords` | `records` | document id |
| `getAppointments` | `appointments` | appointment id |
| `getProblems` | `conditions` | problem id |
| `getAllergies` | `allergies` | allergy id |

`getLetters` and `getMedicalRecords` deliberately share the `records` key so a
single "Records" toggle governs both, matching what a member sees in the nav.

## getMyPatientRecord


**Decision: this handler does NOT call `assertNotSuspended`.** It is the one
endpoint the portal can always reach, so suspension is returned as state rather
than as a `403`. That is what lets the portal render the paused screen instead
of a generic error, and it is why every other handler still fails closed.

```js
const access = await getPortalAccess(elationPatientId);

if (access.status === 'suspended') {
  // 200, but zero PHI. Confirmed contract: the response body is exactly this
  // object and nothing else — no name, DOB, MRN, contact details, provider,
  // membership, appointments, or any clinical field. `modules` is deliberately
  // empty rather than the real map, so the paused screen leaks nothing about
  // what the member would otherwise have. Do not add fields here "for the UI".
  return res.status(200).json({
    payload: { portal: { status: 'suspended', modules: {} } },
  });
}

payload.portal = { status: access.status, modules: access.modules };
```

Because `getPortalAccess` fails open, a Firestore outage here yields a normal
record rather than a false paused screen — while the PHI list endpoints, which
do call `assertNotSuspended`, still deny. Suspension therefore never leaks data
through this path: it returns no clinical payload of its own.

Do **not** send `hiddenItems` to the client — item-level suppression is a
server-side concern and the id list is itself a hint about what exists.

## Two things to keep true


1. `moduleUnavailable: true` with an empty list is not the same as "no results".
   The portal should say the section is unavailable, not "no labs on file" —
   a member seeing "no results" for a hidden section will call the office.
2. Suppression is not deletion. Hidden items stay in Elation and in Firestore
   and remain fully visible to staff in Prime Care OS and in the chart. This
   controls the member's *view* only, and every change is attributed.

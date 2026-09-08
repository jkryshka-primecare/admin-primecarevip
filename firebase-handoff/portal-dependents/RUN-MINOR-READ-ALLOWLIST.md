# Launch gap — real guardian-linked minors and `ELATION_READ_ALLOWLIST`

Question: with `GUARDIAN_READS_ALLOWLIST=*`, can a real guardian read their real
child on day one? Only if the **child's** elationPatientId is on
`ELATION_READ_ALLOWLIST`. The guardian gate and the D-068 subject gate are
independent, and the subject gate runs on the child.

## 1. Are they on it today? Almost certainly not — and it is checkable

The read list has only ever been appended **per claim**, and minors never claim.
Part B step 3b ("add the 175 minors to `ELATION_READ_ALLOWLIST`") was written
precisely because nothing adds them automatically, and `ADULT-BACKFILL.md`
pins the split deliberately:

* `ELATION_INGEST_ALLOWLIST` = 960 adults ∪ 174 minors — this is why minors have
  artifacts at all and why `bySegment.minor` reaches 100%.
* `ELATION_READ_ALLOWLIST` stays at 937 "until coverage passes (step 7)".

So coverage being green proves **ingest** covered the children, not reads.
Confirm against the deployed function before doing anything (ground truth is the
env file on the function, never the masked secret):

```bash
gcloud functions describe getLabs --region us-central1 \
  --format='value(serviceConfig.environmentVariables)' > ~/allow-deployed.txt
# count, and probe a few known minor ids
tr ',' '\n' < ~/allow-deployed.txt | grep -c . 
grep -o '1228288623050753' ~/allow-deployed.txt || echo "MINOR NOT IN READ LIST"
```

A minor absent here fails with 403 `NOT_IN_ALLOWLIST` — a *different* message
from the guardian gate's 404, so misdiagnosis is easy under launch pressure.

## 2. Do the one-time backfill. Do not turn on `ELATION_FULL_SYNC_ENABLED`

`ELATION_FULL_SYNC_ENABLED === 'true'` short-circuits `isIngestAllowed` **and**
the read check in `getLabs` / `getImaging` / `getMedicalRecords` /
`readArtifact.js` — every Elation chart the portal can resolve becomes readable,
including patients who were deliberately never onboarded and every record type
excluded during the census review. It is a containment kill switch, not a launch
setting; `ADULT-BACKFILL.md` steps 7–8 explicitly widen the list and keep
FULL_SYNC off. Keep that.

The correct launch action is a **single deliberate append** of the eligible
minor ids, using the same channel as any other allowlist change
(`GO-LIVE.md` §"Appending an id").

## 3. Deriving the id set

Eligible = exactly the population `ingestEligibility` admits, so reads and
ingest agree and no child gets a metadata row it may not read:

`dependent.isMinor === true` AND at least one `guardians[]` entry with
`status === 'active'`.

```js
// scripts/list-minor-read-ids.js  — read-only, prints ids, writes nothing
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

(async () => {
  const snap = await db.collection('patients').where('dependent.isMinor', '==', true).get();
  const ids = [];
  let skipped = 0;
  snap.forEach((d) => {
    const g = Array.isArray(d.get('guardians')) ? d.get('guardians') : [];
    if (g.some((x) => x && x.status === 'active')) ids.push(d.id);
    else skipped += 1;
  });
  ids.sort();
  console.error(`eligible ${ids.length}, skipped (no active guardian) ${skipped}`);
  process.stdout.write(ids.join(','));
})();
```

Then, per `GO-LIVE.md`:

```bash
node scripts/list-minor-read-ids.js > ~/minor-ids.txt 2> ~/minor-ids.log
# dedupe against the deployed snapshot, keep only genuinely new ids
tr ',' '\n' < ~/allow-deployed.txt | sort -u > ~/old.txt
tr ',' '\n' < ~/minor-ids.txt      | sort -u > ~/new.txt
comm -13 ~/old.txt ~/new.txt > ~/to-add.txt && wc -l < ~/to-add.txt

printf '%s' "$(cat ~/allow-deployed.txt),$(paste -sd, ~/to-add.txt)" > ~/allow-next.txt
gh secret set ELATION_READ_ALLOWLIST_PRODUCTION < ~/allow-next.txt
# re-run the last "Deploy to Production" run from Actions (never an empty commit)
```

Verify content-based, not CI-green: `sorted diff` of old vs new deployed value
shows exactly the `to-add` ids as `>` lines and N → N+len; repeat the diff on a
second function to catch the D-071 silent no-op.

## 4. Ordering against the `*` flip

Append the minors **first**, redeploy, verify the diff, then flip
`GUARDIAN_READS_ALLOWLIST=*`. In that order a guardian's first read either works
or fails on the guardian gate alone; the reverse order produces 403s that look
like a guardian-link bug and invite the wrong fix (turning on FULL_SYNC).

## 5. Standing gap

Nothing appends a *newly added* minor to the read list after launch. Until
onboarding automates it (#496), a new dependent needs the same append. Worth a
weekly check: minors eligible per §3 minus ids present in the deployed list
should be empty.

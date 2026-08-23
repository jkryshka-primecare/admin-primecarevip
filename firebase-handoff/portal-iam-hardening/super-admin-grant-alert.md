# Alert — `super_admin` granted

`setUserRole` emits a WARNING line on every `super_admin` grant:

```json
{ "severity": "WARNING", "fn": "setUserRole", "event": "super_admin_granted",
  "targetUid": "...", "previousRole": "admin", "actorUid": "...",
  "actorEmail": "...", "auditId": "..." }
```

In steady state this should fire approximately never, so it pages rather than
just logging.

## Log-based metric

```bash
gcloud logging metrics create super_admin_granted \
  --project=prive-care-vip \
  --description="A super_admin role was granted via setUserRole" \
  --log-filter='resource.type="cloud_function"
    resource.labels.function_name="setUserRole"
    jsonPayload.event="super_admin_granted"'
```

## Alert policy

Any occurrence in a 5-minute window, notifying the security channel:

```bash
gcloud alpha monitoring policies create --project=prive-care-vip --policy-from-file=- <<'YAML'
displayName: "super_admin granted"
combiner: OR
conditions:
  - displayName: "setUserRole granted super_admin"
    conditionThreshold:
      filter: >
        metric.type="logging.googleapis.com/user/super_admin_granted"
        AND resource.type="cloud_function"
      comparison: COMPARISON_GT
      thresholdValue: 0
      duration: 0s
      aggregations:
        - alignmentPeriod: 300s
          perSeriesAligner: ALIGN_SUM
notificationChannels:
  - projects/prive-care-vip/notificationChannels/REPLACE_ME
documentation:
  content: |
    A super_admin role was granted. Cross-check the matching row in the
    Firestore `role_change_audit` collection (actorUid, targetUid, reason).
    If the grant was not expected, revoke it and rotate the actor's session.
  mimeType: text/markdown
YAML
```

Replace `REPLACE_ME` with the same notification channel used by the
sweep-invite-failure alert.

## Companion check

`role_change_audit` is the durable record; the log line is the trigger. If an
alert fires with no matching audit row, treat it as tampering — the handler
writes the row before the claim is set, so the row must exist first.

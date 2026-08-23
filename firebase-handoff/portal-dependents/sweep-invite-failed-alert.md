# Cloud Logging alert — `dependentBirthdaySweep` invite failures

Interim cover while the reconciler is pending. When the birthday sweep converts
a dependent to adult it must issue that new adult their own portal invite. If
that invite send fails, the person is now an adult with no guardian proxy and no
account of their own — silently orphaned. Until the reconciler re-drives those
cases automatically, a human has to re-invite them, so the failure must page
someone.

## Log-based metric

```bash
gcloud logging metrics create sweep_invite_failed \
  --project=prive-care-vip \
  --description="dependentBirthdaySweep failed to send a converted adult their invite" \
  --log-filter='resource.type="cloud_function"
resource.labels.function_name="dependentBirthdaySweep"
(jsonPayload.event="invite-failed" OR textPayload:"invite-failed")'
```

If the sweep's logger emits a different event token, match that token instead —
grep the sweep for its invite-failure log line before creating the metric and
confirm the filter returns rows in Logs Explorer over the last conversion run.

## Alert policy

- Condition: `logging.googleapis.com/user/sweep_invite_failed` **count > 0** over
  a 10-minute rolling window (the sweep runs daily at 07:15 America/New_York).
- Auto-close: 24 hours.
- Severity: this is a member-access incident, not a nightly-job wobble — route it
  to the same channel as the artifact repair `parked` alert.
- Documentation on the policy (shown in the notification):

  > A dependent aged out and could not be sent their own portal invite. They now
  > have no guardian proxy and no account. Re-invite them manually from
  > Admin → Users, then confirm claim state. Remove this manual step once the
  > reconciler ships.

## Retire when

The reconciler + paired sweep invite-state stamp lands and has run clean for one
week. At that point the stamp makes the orphan state queryable and the
reconciler re-drives it; keep the alert as a backstop but drop its severity.

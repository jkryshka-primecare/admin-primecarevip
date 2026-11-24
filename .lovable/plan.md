# How PRs, branches and merges work in `prime-care-vip-app-v2`

Read live from GitHub on Nov 24, 2026 (read-only). Approving this plan only saves this write-up as `docs/github-workflow.md` and opens a PR with just that file. Nothing else changes.

## 1. Repository basics
- Private repo. The default branch is `main`, and `main` is production: every push to `main` deploys.
- All three merge methods are on (merge commit, squash, rebase). In practice every recent PR was **squash-merged**: one commit on `main` per PR, titled "PR title (#N)".
- Auto-merge is off. "Update branch" button is off. Merged branches are **not** deleted automatically, so the repo now has 100+ branches.
- There's no CODEOWNERS file, so no one is assigned as a reviewer automatically.

## 2. Branch protection
- **`staging`**: has a ruleset. It blocks deleting the branch and force-pushing. Changes need a PR with 1 approval, and nobody can bypass that.
- **`main`**: no ruleset covers `main`. My access can't read the classic protection settings (GitHub returned 403), so I can't confirm whether `main` requires reviews or passing checks. A repo admin can check under Settings → Branches.
- That means `main` may have weaker protection than `staging`, even though it's the branch that deploys. Worth checking.

## 3. Branch naming (what's actually in use)
```text
fix/<topic>[-<issue>]     code fixes        e.g. fix/claim-token-reservation-619
ci/<topic>-<issue>        pipeline changes  e.g. ci/claim-hydration-gate-threedot-612
docs/<topic>              docs/plans/recaps e.g. docs/stripe-transition-plan-20261121
chore/<topic>             config/arming     e.g. chore/arm-c4-batch-reissue-20261114
recaps/<topic>            session recaps
dependabot/...            automatic dependency updates
backup/<name>             snapshots (e.g. backup/ui-redesign-2026-07-15)
```

## 4. How a change gets from idea to production
```text
Issue (filed by the owner; my token can't create issues: 403)
  -> feature branch off current main
  -> draft PR, description "Closes #N" (added only once the real number exists)
  -> automatic checks run on the PR
  -> review (you and Claude), then marked ready
  -> merged into main by mkieffer23-max (squash)
  -> push to main triggers "Deploy to Production"
```
- Stacked PRs (for example #605 on top of #604) get rebased onto `main` after the lower PR merges. Then the branch is force-pushed so the PR shows only its own change.
- My standing rule: I never merge, deploy or turn on sending. I stop at an open PR with green checks.

## 5. Automated checks (17 workflows plus Dependabot)
- **Safety and security:** TruffleHog secret scan, "No plaintext vendor credentials", Red-team (artifact ownership and bucket privacy).
- **Portal behavior:** claim-hydration-gate (the main gate; on pull requests it skips the full suite for docs-only changes, and an owner can start the full run by hand), social-signin-gate, logical-social-gate, portal-enforcement-test.
- **Invites and roster:** invite-send-safety, invite-status-test, auto-invite-test, roster-discovery-test, roster-backfill-test, sync-email-test, sendgrid-event-webhook-gate, firestore-targets.
- **Pipeline:** deploy-pipeline-test.
- **Deploy:** "Deploy to Production" runs on every push to `main`. Runs never overlap. The functions deploy separately from hosting and rules. It takes a before-deploy snapshot of every function, runs a health check even if the deploy fails, and re-locks admin access afterwards no matter what happened.
- **Dependabot:** opens dependency PRs automatically (many are open now, including some for the old `troy-flutter-reference` folder).

## 6. Things to watch right now
- **The last production deploy failed.** "Deploy to Production" failed on `main` at `b05419471c`, the merge of #627 (the hotfix that was supposed to make the first hardened deploy pass). We need to look at that run next.
- It isn't clear what protects `main` (see section 2).
- Merged branches pile up because they're never deleted automatically.
- Allowing all three merge methods means someone could accidentally merge with a plain merge commit instead of squash.

## Optional follow-ups (not done unless you approve each one)
1. Look into the failed deploy of #627. I'd only read the logs.
2. A repo admin confirms or adds protection on `main`: 1 approval, required checks (claim-hydration-gate, TruffleHog, invite-send-safety), no force-push.
3. Allow squash merges only, and turn on automatic deletion of merged branches.

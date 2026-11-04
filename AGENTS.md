# Project rules

- Elation scripts reach the pharmacy queue through the `elation-rx-sync` function, which resumes Elation's /medications/ list from a stored medication-id cursor. Why: Elation ignores date filters on that list.
- The Elation import runs while a pharmacy page is open (every 5 minutes) and on demand. Why: this project has no managed server-side schedule support.
- Program and billing rules (which note keywords count, who gets billed) live in `supabase/functions/_shared/rxProgram.ts`, with tests in `src/test`. Why: one tested source for money rules.
- Cross-project portal frontend proposals live under firebase-handoff as review-only source patches, never imported into this admin app or written into read-only snapshots; apply and verify them in the owning project because cross-project writes cannot update its release.
- Providers-disabled portal auth proposals use server-bound attempts and transactional logical identity mappings with custom tokens, not native Auth provider links; keep them review-only until owning-project and isolated hosted checks pass because emulator behavior cannot certify hosted provider enforcement.
- Mobile iOS dependency remediation is staged under firebase-handoff and delivered through the owning repository; validate the actual EAS post-pod-install lockfile before release because JS versions and local fixture tests cannot certify bundled native dependencies.
- Disposable hosted social tests use a project-guarded harness and in-memory genuine provider tokens, recording sanitized results only; isolated adapters never certify live integration behavior.

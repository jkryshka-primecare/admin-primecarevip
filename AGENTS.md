# Project rules

- Elation scripts reach the pharmacy queue through the `elation-rx-sync` function, which resumes Elation's /medications/ list from a stored medication-id cursor. Why: Elation ignores date filters on that list.
- The Elation import runs while a pharmacy page is open (every 5 minutes) and on demand. Why: this project has no managed server-side schedule support.
- Program and billing rules (which note keywords count, who gets billed) live in `supabase/functions/_shared/rxProgram.ts`, with tests in `src/test`. Why: one tested source for money rules.

## Add CPT catalog seed to the report bundle

Export the current `cpt_codes` table (~1,164 rows) from the database to a CSV file that ships alongside the Cost Estimator portability report, so the receiving project can load it directly into their `cpt_codes` table after running the schema migration.

### What gets produced
- `/mnt/documents/cpt_codes_seed.csv` — full export of `public.cpt_codes`
  - Columns: `id, code, description, category, created_at, updated_at` (whatever the live schema has)
  - UTF-8, comma-delimited, header row, quoted strings

### How
1. `psql ... COPY (SELECT * FROM public.cpt_codes ORDER BY code) TO STDOUT WITH CSV HEADER` → write to `/mnt/documents/cpt_codes_seed.csv`.
2. Verify row count matches the report's stated 1,164.
3. Append a short "CPT catalog seed" subsection to `cost-estimator-module-report.md` under section 9 (Seed reference data) explaining:
   - file name, row count, column list
   - one-line import command: `\copy public.cpt_codes FROM 'cpt_codes_seed.csv' WITH CSV HEADER`
4. Regenerate `cost-estimator-module-report.docx` from the updated markdown via pandoc.
5. Emit `<presentation-artifact>` tags for both the CSV and the refreshed DOCX.

### Out of scope
- Specialties, providers, services, service_prices exports (not requested).
- Any schema or app code changes.

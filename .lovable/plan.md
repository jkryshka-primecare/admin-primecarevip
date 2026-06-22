## Add full pricing dataset to the Cost Estimator report bundle

Export all live pricing tables as CSVs and ship them alongside the existing report + CPT catalog, so the receiving project can stand up a fully-populated price book on day one.

### What gets produced (in `/mnt/documents/`)

New CSV exports:
- `specialties_seed.csv` — every row from `public.specialties`
- `providers_seed.csv` — every row from `public.providers` (names, addresses, phone, fax, specialty, categories, distance, last_price_update)
- `services_seed.csv` — every row from `public.services` (id, name, cpt_code, specialty_id, icd10_codes, nhsn_category, description)
- `service_prices_seed.csv` — every row from `public.service_prices` (provider_id, service_id, component, price)
- `cpt_codes_seed.csv` — already shipped, kept as-is

Updated report:
- `cost-estimator-module-report_v2.md` / `.docx` — section 9 (Seed reference data) expanded with:
  - one subsection per CSV: row count, column list, FK dependencies, import command
  - explicit load order (specialties → cpt_codes → services → providers → service_prices)
  - note on `icd10_codes` (Postgres `text[]` — `\copy` handles `{a,b,c}` literal)
  - note that `price_audit_log` is intentionally excluded (history, not seed)

### How

1. For each table run `psql -c "COPY (SELECT ... ORDER BY ...) TO STDOUT WITH CSV HEADER" > /mnt/documents/<name>_seed.csv`.
2. Capture row counts for the report.
3. Rewrite section 9 of the markdown with the new subsections and load-order block.
4. Regenerate the DOCX via pandoc as `cost-estimator-module-report_v2.docx` (keep the v1 file untouched).
5. Emit `<presentation-artifact>` tags for the 4 new CSVs and the v2 DOCX.

### Load order (for the report)

```text
1. specialties_seed.csv      → public.specialties
2. cpt_codes_seed.csv        → public.cpt_codes
3. services_seed.csv         → public.services      (FK: specialty_id, cpt_code)
4. providers_seed.csv        → public.providers     (FK: specialty_id)
5. service_prices_seed.csv   → public.service_prices (FK: provider_id, service_id)
```

### Out of scope

- `price_audit_log` (history, not seed; can contain user names).
- No anonymization — provider names/addresses/phones are exported as-is.
- No schema or app code changes in this project.

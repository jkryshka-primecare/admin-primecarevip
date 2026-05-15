## Primecare VIP RX — Module Report

Build a single Excel workbook (`PrimecareVIP_RX_Report.xlsx`) covering all 5 sections from the dropdown: **Dashboard, Inventory, Dispense, History, Scanner**. Combines system documentation (how each section works) with a full snapshot of live data from the database.

### Workbook structure

1. **Cover** — Title, generated timestamp, brand colors, KPI strip (medications, units, inventory value, dispenses, today's revenue/margin, low-stock count, expiring count, pending billing count).
2. **Overview & Architecture** — One-page narrative: module purpose, navigation, tech stack (React/TanStack Query, Supabase tables, Hint billing integration, Elation Rx ingestion, GS1/NDC scanner), and section map.
3. **Dashboard — Docs** — Explains KPIs (Total Meds, Low Stock, Dispensed Today, Today's Revenue, Today's Margin %, Inventory Value), Prescription Queue panel, Pending Billing panel, Low Stock + Expiring widgets. Documents the margin formula and data sources.
4. **Inventory — Docs + Data** — Documents fields, low-stock/expiring logic, split-lot dialog, NDC codes. Then dumps **all `medications` rows** with computed columns (stock value at cost, at retail, margin %, days-to-expiry, low-stock flag).
5. **Dispense — Docs** — Documents the fill flow (queue → label → record), label printing, DEA schedule handling, refills, Hint charge creation.
6. **History — Data** — Full `dispense_records` dump with key columns (rx#, patient, med, qty, unit price, total, prescriber, dispensed_at, reversal status, Hint billing status/charge id).
7. **Prescription Queue — Data** — Full `prescription_queue` rows (status, patient, med, prescriber, source payload reference).
8. **Hint Billing — Data** — Filtered view of dispenses with Hint status (pending / billed / voided / errored) + error messages.
9. **Low Stock & Expiring** — Two tables: items at/under reorder level; items expiring within 90 days.
10. **Scanner — Docs** — Documents the GS1 parser, NDC lookup flow, supported barcode formats, and how scanned items resolve to inventory rows.
11. **Price Audit Log** — `price_audit_log` rows (component price changes for context with billing).
12. **Summary KPIs** — Aggregate stats (total inventory $, avg margin %, top 10 highest-value SKUs, dispenses by month, revenue by month).

### Technical approach

- Pull all data via `psql COPY` to CSV, load with pandas.
- Build workbook with `openpyxl`: brand-colored headers (navy `#04244C` + aqua `#00B8FF` accents), frozen header rows, auto-width columns, currency formatting on `$` columns, conditional formatting (red for low stock / expiring < 30d, green for healthy margin).
- Documentation sheets use wrapped cells, section headings in Tinos-equivalent serif (Cambria fallback), body in Calibri.
- Output to `/mnt/documents/PrimecareVIP_RX_Report.xlsx`.
- QA: convert to PDF via LibreOffice, render each page as JPEG, inspect for clipped text / broken layout, fix and regenerate.

### Notes from data check

Current DB has 18 medications, 0 dispense records, 0 queue items. Data sheets for History/Queue/Billing will render with headers + "no records" placeholder rather than being omitted, so the report structure is complete and ready to populate as activity occurs.

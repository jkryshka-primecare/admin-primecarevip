## Update Insights filter dropdowns

Edit `src/components/engagement/mockData.ts` to replace the option arrays consumed by `ReportFilterBar`.

**Employer options** (replace current 3):
- Aligned Marketplace
- Ernst & Young
- KD Nutra
- Mind And Mobility
- Persona Healthcare Direct
- Prime Care VIP Health - Retail

**Physician options** (replace current 3):
- Jarrod Frydman
- Lainey Kieffer
- Melissa Buchanan
- Michael Kieffer
- Nicole Aguila
- Raphael Lopez
- Shannon Nelson

### Notes
- Existing mock `enrolledPatients` rows reference old employers (Acme Holdings, Bridgewater Group, Hero Logistics) and old physicians (Dr. Patel/Cho/Singh). Selecting any of the new options will return 0 matched patients until the mock dataset is reseeded — which is expected for now since the request is only to update the dropdown choices. No other files need changes.
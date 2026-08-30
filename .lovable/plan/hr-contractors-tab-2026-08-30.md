# HR: Contractors tab

Add a "Contractors" sub-tab in the HR module that mirrors the Employees tab, for entering independent contractors (1099s).

## What you get

- New tab **Contractors** in the HR nav, right after Employees.
- List view identical in layout to Employees: search by name/email, filter chips (by status), table with avatar/name, company, role, status, contact.
- **Add Contractor** button (HR admins only) opening a dialog modeled on Add Employee.
- Clicking a row opens a contractor detail page with the same look as the employee detail view (profile, contract info, notes).

## Contractor fields

Personal/contact: first name, last name, email, phone, address.
Business: company/DBA name, tax ID (EIN or SSN, masked), W-9 on file (yes/no).
Engagement: role/service provided, department, start date, end date, status (active / inactive / terminated), rate, rate type (hourly / daily / per project / retainer), contract number, notes.

## Technical notes

- New table `public.hr_contractors` (separate from `hr_employees` so contractors never mix into payroll, PTO, org chart, or reviews).
- Migration order: CREATE TABLE → GRANT to `authenticated`/`service_role` → ENABLE RLS → policies.
- RLS mirrors `hr_employees`: `is_hr_manager(auth.uid())` for full manage/read; staff get no read (contractor tax data is sensitive). Enum `hr_contractor_status` with active / inactive / terminated.
- Files: `src/pages/hr/HrContractors.tsx`, `src/pages/hr/HrContractorDetail.tsx`, `src/components/hr/AddContractorDialog.tsx`; routes added in `HrHome.tsx`; tab added in `HrLayout.tsx`.
- Styling reuses existing semantic tokens — no new design system work.

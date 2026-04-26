GRANT INSERT, SELECT, UPDATE ON public.specialties, public.providers, public.services, public.service_prices, public.icd10_codes TO sandbox_exec;
ALTER TABLE public.specialties FORCE ROW LEVEL SECURITY;
-- Allow sandbox_exec to bypass RLS on these specific tables for bulk import
CREATE POLICY "sandbox_exec_bulk_import_specialties" ON public.specialties FOR ALL TO sandbox_exec USING (true) WITH CHECK (true);
CREATE POLICY "sandbox_exec_bulk_import_providers" ON public.providers FOR ALL TO sandbox_exec USING (true) WITH CHECK (true);
CREATE POLICY "sandbox_exec_bulk_import_services" ON public.services FOR ALL TO sandbox_exec USING (true) WITH CHECK (true);
CREATE POLICY "sandbox_exec_bulk_import_service_prices" ON public.service_prices FOR ALL TO sandbox_exec USING (true) WITH CHECK (true);
CREATE POLICY "sandbox_exec_bulk_import_icd10_codes" ON public.icd10_codes FOR ALL TO sandbox_exec USING (true) WITH CHECK (true);
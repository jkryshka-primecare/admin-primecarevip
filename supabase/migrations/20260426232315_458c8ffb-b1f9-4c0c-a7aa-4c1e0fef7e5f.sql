DROP POLICY IF EXISTS "sandbox_exec_bulk_import_specialties" ON public.specialties;
DROP POLICY IF EXISTS "sandbox_exec_bulk_import_providers" ON public.providers;
DROP POLICY IF EXISTS "sandbox_exec_bulk_import_services" ON public.services;
DROP POLICY IF EXISTS "sandbox_exec_bulk_import_service_prices" ON public.service_prices;
DROP POLICY IF EXISTS "sandbox_exec_bulk_import_icd10_codes" ON public.icd10_codes;
ALTER TABLE public.specialties NO FORCE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE ON public.specialties, public.providers, public.services, public.service_prices, public.icd10_codes FROM sandbox_exec;
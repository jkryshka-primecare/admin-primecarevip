DROP POLICY IF EXISTS "sandbox_exec_bulk_import_cpt_codes" ON public.cpt_codes;
DROP POLICY IF EXISTS "sandbox_exec_bulk_import_services_cpt" ON public.services;
REVOKE INSERT, UPDATE ON public.cpt_codes FROM sandbox_exec;
REVOKE INSERT, UPDATE ON public.services FROM sandbox_exec;
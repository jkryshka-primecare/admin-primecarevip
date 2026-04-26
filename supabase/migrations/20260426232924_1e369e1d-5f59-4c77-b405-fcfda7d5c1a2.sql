-- Reference table for the official approved CPT codes (NHSN 2026)
CREATE TABLE public.cpt_codes (
  code text PRIMARY KEY,
  category text NOT NULL,
  description text NOT NULL,
  status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cpt_codes_category ON public.cpt_codes (category);

ALTER TABLE public.cpt_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read cpt_codes" ON public.cpt_codes
  FOR SELECT TO authenticated USING (is_staff(auth.uid()));

CREATE POLICY "Admins manage cpt_codes" ON public.cpt_codes
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE TRIGGER cpt_codes_updated_at BEFORE UPDATE ON public.cpt_codes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Add CPT/NHSN columns to services
ALTER TABLE public.services
  ADD COLUMN cpt_code text,
  ADD COLUMN nhsn_category text;

CREATE INDEX idx_services_cpt_code ON public.services (cpt_code) WHERE cpt_code IS NOT NULL;
CREATE INDEX idx_services_nhsn_category ON public.services (nhsn_category) WHERE nhsn_category IS NOT NULL;

-- Backfill cpt_code from existing cpt-* service IDs (uppercase to match standard CPT formatting)
UPDATE public.services
SET cpt_code = upper(substring(id from 5))
WHERE id LIKE 'cpt-%';

-- Temporary import grants for sandbox_exec (revoked after load)
GRANT INSERT, SELECT, UPDATE ON public.cpt_codes TO sandbox_exec;
GRANT INSERT, UPDATE ON public.services TO sandbox_exec;
CREATE POLICY "sandbox_exec_bulk_import_cpt_codes" ON public.cpt_codes FOR ALL TO sandbox_exec USING (true) WITH CHECK (true);
CREATE POLICY "sandbox_exec_bulk_import_services_cpt" ON public.services FOR ALL TO sandbox_exec USING (true) WITH CHECK (true);
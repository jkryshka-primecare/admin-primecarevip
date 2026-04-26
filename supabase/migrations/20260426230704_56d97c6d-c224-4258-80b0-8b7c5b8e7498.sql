-- ===========================================================================
-- Cost Estimator module schema (ported from Care Connect Hub project)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- specialties
-- ---------------------------------------------------------------------------
CREATE TABLE public.specialties (
  id text PRIMARY KEY,
  name text NOT NULL,
  icon text NOT NULL DEFAULT 'Stethoscope',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.specialties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read specialties" ON public.specialties
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE POLICY "Admins manage specialties" ON public.specialties
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE TRIGGER update_specialties_updated_at
  BEFORE UPDATE ON public.specialties
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- providers
-- ---------------------------------------------------------------------------
CREATE TABLE public.providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  specialty_id text NOT NULL REFERENCES public.specialties(id) ON DELETE CASCADE,
  address text,
  city text NOT NULL,
  state text NOT NULL DEFAULT 'FL',
  zip text,
  phone text NOT NULL,
  distance numeric,
  last_price_update date DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read providers" ON public.providers
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE POLICY "Admins manage providers" ON public.providers
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE TRIGGER update_providers_updated_at
  BEFORE UPDATE ON public.providers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_providers_specialty ON public.providers(specialty_id);

-- ---------------------------------------------------------------------------
-- services
-- ---------------------------------------------------------------------------
CREATE TABLE public.services (
  id text PRIMARY KEY,
  name text NOT NULL,
  specialty_id text NOT NULL REFERENCES public.specialties(id) ON DELETE CASCADE,
  description text,
  icd10_codes text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read services" ON public.services
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE POLICY "Admins manage services" ON public.services
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE TRIGGER update_services_updated_at
  BEFORE UPDATE ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_services_specialty ON public.services(specialty_id);

-- ---------------------------------------------------------------------------
-- service_prices
-- ---------------------------------------------------------------------------
CREATE TABLE public.service_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  service_id text NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  component text NOT NULL,
  price numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_prices_provider_service_component_key UNIQUE (provider_id, service_id, component)
);

ALTER TABLE public.service_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read service_prices" ON public.service_prices
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE POLICY "Admins manage service_prices" ON public.service_prices
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE TRIGGER update_service_prices_updated_at
  BEFORE UPDATE ON public.service_prices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_service_prices_provider ON public.service_prices(provider_id);
CREATE INDEX idx_service_prices_service ON public.service_prices(service_id);

-- ---------------------------------------------------------------------------
-- icd10_codes
-- ---------------------------------------------------------------------------
CREATE TABLE public.icd10_codes (
  code text PRIMARY KEY,
  short_description text NOT NULL,
  long_description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.icd10_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read icd10_codes" ON public.icd10_codes
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE POLICY "Admins manage icd10_codes" ON public.icd10_codes
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE INDEX idx_icd10_codes_short_desc
  ON public.icd10_codes USING gin(to_tsvector('english', short_description));

-- ---------------------------------------------------------------------------
-- price_audit_log
-- ---------------------------------------------------------------------------
CREATE TABLE public.price_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_price_id uuid NOT NULL,
  provider_id uuid NOT NULL,
  service_id text NOT NULL,
  component text NOT NULL,
  old_price numeric NOT NULL,
  new_price numeric NOT NULL,
  changed_by uuid,
  changed_by_name text,
  changed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.price_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read price_audit_log" ON public.price_audit_log
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE POLICY "Admins write price_audit_log" ON public.price_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE INDEX idx_price_audit_log_service_price ON public.price_audit_log(service_price_id);
CREATE INDEX idx_price_audit_log_changed_at ON public.price_audit_log(changed_at DESC);

-- ---------------------------------------------------------------------------
-- import_jobs
-- ---------------------------------------------------------------------------
CREATE TABLE public.import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL,
  provider_id uuid REFERENCES public.providers(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  rows_imported integer NOT NULL DEFAULT 0,
  total_rows integer,
  byte_offset bigint NOT NULL DEFAULT 0,
  total_bytes bigint,
  hospital_name text,
  hospital_address text,
  hospital_city text,
  hospital_state text,
  hospital_zip text,
  error_message text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read import_jobs" ON public.import_jobs
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE POLICY "Admins manage import_jobs" ON public.import_jobs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Service role manages import_jobs" ON public.import_jobs
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER update_import_jobs_updated_at
  BEFORE UPDATE ON public.import_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Storage bucket: pricing-uploads (private, 5 GB limit)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('pricing-uploads', 'pricing-uploads', false, 5368709120)
ON CONFLICT (id) DO UPDATE SET file_size_limit = 5368709120, public = false;

CREATE POLICY "Admins upload pricing files"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'pricing-uploads'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  );

CREATE POLICY "Admins read pricing files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'pricing-uploads'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  );

CREATE POLICY "Admins delete pricing files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'pricing-uploads'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  );

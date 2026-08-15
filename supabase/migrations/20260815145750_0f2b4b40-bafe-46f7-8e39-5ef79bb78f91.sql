CREATE TABLE public.integration_health_checks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  integration text NOT NULL,
  scope text,
  resource text,
  ok boolean NOT NULL,
  http_status integer,
  elapsed_ms integer,
  error_message text,
  checked_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.integration_health_checks TO authenticated;
GRANT ALL ON public.integration_health_checks TO service_role;

ALTER TABLE public.integration_health_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view integration health checks"
  ON public.integration_health_checks
  FOR SELECT
  TO authenticated
  USING (public.is_hr_admin(auth.uid()));

CREATE POLICY "No client inserts on integration health checks"
  ON public.integration_health_checks
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

CREATE POLICY "No client updates on integration health checks"
  ON public.integration_health_checks
  FOR UPDATE
  TO authenticated
  USING (false);

CREATE POLICY "No client deletes on integration health checks"
  ON public.integration_health_checks
  FOR DELETE
  TO authenticated
  USING (false);

CREATE INDEX idx_integration_health_checks_checked_at
  ON public.integration_health_checks (checked_at DESC);
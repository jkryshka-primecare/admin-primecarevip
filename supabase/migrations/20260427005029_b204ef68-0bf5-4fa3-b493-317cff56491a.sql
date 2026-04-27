CREATE TABLE public.hr_settings (
  id boolean PRIMARY KEY DEFAULT true,
  google_calendar_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT hr_settings_singleton CHECK (id = true)
);

ALTER TABLE public.hr_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "HR read hr_settings"
  ON public.hr_settings FOR SELECT
  TO authenticated
  USING (public.is_hr_manager(auth.uid()));

CREATE POLICY "HR manage hr_settings"
  ON public.hr_settings FOR ALL
  TO authenticated
  USING (public.is_hr_manager(auth.uid()))
  WITH CHECK (public.is_hr_manager(auth.uid()));

CREATE TRIGGER update_hr_settings_updated_at
  BEFORE UPDATE ON public.hr_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.hr_settings (id) VALUES (true) ON CONFLICT DO NOTHING;
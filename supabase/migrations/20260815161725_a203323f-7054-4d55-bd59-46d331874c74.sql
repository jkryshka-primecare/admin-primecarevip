CREATE TABLE public.portal_admin_actions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_user_id uuid REFERENCES auth.users(id),
  actor_email text,
  elation_patient_id text,
  action text NOT NULL,
  reason text,
  before_state jsonb,
  after_state jsonb,
  ok boolean NOT NULL DEFAULT true,
  http_status integer,
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.portal_admin_actions TO authenticated;
GRANT ALL ON public.portal_admin_actions TO service_role;

ALTER TABLE public.portal_admin_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read portal admin actions"
  ON public.portal_admin_actions
  FOR SELECT
  TO authenticated
  USING (public.is_hr_admin(auth.uid()));

CREATE POLICY "No client inserts to portal admin actions"
  ON public.portal_admin_actions
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

CREATE INDEX idx_portal_admin_actions_patient ON public.portal_admin_actions (elation_patient_id, created_at DESC);
CREATE INDEX idx_portal_admin_actions_created ON public.portal_admin_actions (created_at DESC);
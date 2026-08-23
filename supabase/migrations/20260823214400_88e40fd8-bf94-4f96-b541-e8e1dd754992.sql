-- 1. Tamper-evident audit trail for role changes
CREATE TABLE public.role_change_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  target_user_id uuid NOT NULL,
  previous_role app_role,
  new_role app_role,
  privileged boolean NOT NULL DEFAULT false,
  actor_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.role_change_audit TO authenticated;
GRANT ALL ON public.role_change_audit TO service_role;

ALTER TABLE public.role_change_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins read role change audit"
  ON public.role_change_audit FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

-- No client writes: rows come only from the SECURITY DEFINER trigger below.

CREATE OR REPLACE FUNCTION public.audit_user_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.role_change_audit (action, target_user_id, previous_role, new_role, privileged, actor_user_id)
    VALUES ('grant', NEW.user_id, NULL, NEW.role, NEW.role IN ('admin','super_admin'), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.role_change_audit (action, target_user_id, previous_role, new_role, privileged, actor_user_id)
    VALUES ('change', NEW.user_id, OLD.role, NEW.role, NEW.role IN ('admin','super_admin') OR OLD.role IN ('admin','super_admin'), auth.uid());
    RETURN NEW;
  ELSE
    INSERT INTO public.role_change_audit (action, target_user_id, previous_role, new_role, privileged, actor_user_id)
    VALUES ('revoke', OLD.user_id, OLD.role, NULL, OLD.role IN ('admin','super_admin'), auth.uid());
    RETURN OLD;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_user_role_change ON public.user_roles;
CREATE TRIGGER trg_audit_user_role_change
  AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.audit_user_role_change();

-- 2. Replace the blanket admin write policy
DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;

-- Reads: admins and super admins see everything (self-read policy already exists)
CREATE POLICY "Admins read all roles v2"
  ON public.user_roles FOR SELECT TO authenticated
  USING (public.is_hr_admin(auth.uid()));

-- Writes: never on your own row; privileged roles are super_admin-only
CREATE POLICY "Role grants are gated"
  ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (
    user_id <> auth.uid()
    AND (
      public.has_role(auth.uid(), 'super_admin')
      OR (public.has_role(auth.uid(), 'admin') AND role NOT IN ('admin','super_admin'))
    )
  );

CREATE POLICY "Role updates are gated"
  ON public.user_roles FOR UPDATE TO authenticated
  USING (
    user_id <> auth.uid()
    AND (
      public.has_role(auth.uid(), 'super_admin')
      OR (public.has_role(auth.uid(), 'admin') AND role NOT IN ('admin','super_admin'))
    )
  )
  WITH CHECK (
    user_id <> auth.uid()
    AND (
      public.has_role(auth.uid(), 'super_admin')
      OR (public.has_role(auth.uid(), 'admin') AND role NOT IN ('admin','super_admin'))
    )
  );

CREATE POLICY "Role revocations are gated"
  ON public.user_roles FOR DELETE TO authenticated
  USING (
    user_id <> auth.uid()
    AND (
      public.has_role(auth.uid(), 'super_admin')
      OR (public.has_role(auth.uid(), 'admin') AND role NOT IN ('admin','super_admin'))
    )
  );
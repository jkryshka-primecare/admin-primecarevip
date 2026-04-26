-- Drop the leftover trigger that blocked the previous migration.
DROP TRIGGER IF EXISTS trg_enforce_allowed_signup_domain ON auth.users;
DROP TRIGGER IF EXISTS enforce_allowed_signup_domain_trg ON auth.users;

-- =====================================================================
-- 1. Swap app_role enum to the new role set
-- =====================================================================

CREATE TYPE public.app_role_v2 AS ENUM (
  'super_admin','admin','pharmacy','clinical','hr','billing','staff','pending'
);

DROP POLICY IF EXISTS "Admins manage allowed domains" ON public.allowed_signup_domains;
DROP POLICY IF EXISTS "Admins read allowed domains" ON public.allowed_signup_domains;
DROP POLICY IF EXISTS "Admins read audit log" ON public.phi_access_log;
DROP POLICY IF EXISTS "Admins read all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins read all roles" ON public.user_roles;

DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);
DROP FUNCTION IF EXISTS public.is_staff(uuid);

ALTER TABLE public.user_roles
  ALTER COLUMN role TYPE text USING role::text;

UPDATE public.user_roles
  SET role = 'clinical'
  WHERE role = 'clinician';

ALTER TABLE public.user_roles
  ALTER COLUMN role TYPE public.app_role_v2 USING role::public.app_role_v2;

DROP TYPE public.app_role;
ALTER TYPE public.app_role_v2 RENAME TO app_role;

-- =====================================================================
-- 2. has_role / is_staff
-- =====================================================================

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('super_admin','admin','clinical','pharmacy','billing')
  );
$$;

-- =====================================================================
-- 3. Restore RLS policies
-- =====================================================================

CREATE POLICY "Admins read audit log"
  ON public.phi_access_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY "Admins read all profiles"
  ON public.profiles
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY "Admins manage roles"
  ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'super_admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY "Admins read all roles"
  ON public.user_roles
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

-- =====================================================================
-- 4. Drop allowed_signup_domains
-- =====================================================================

DROP FUNCTION IF EXISTS public.enforce_allowed_signup_domain() CASCADE;
DROP FUNCTION IF EXISTS public.normalize_signup_domain() CASCADE;
DROP TABLE IF EXISTS public.allowed_signup_domains;

-- =====================================================================
-- 5. handle_new_user — defaults to 'pending'
-- =====================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name',
             NEW.raw_user_meta_data->>'name',
             NEW.email)
  )
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'pending')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================================================================
-- 6. Invitations table + claim trigger
-- =====================================================================

CREATE TABLE public.invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token       uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  first_name  text NOT NULL,
  last_name   text NOT NULL,
  email       text NOT NULL,
  role        public.app_role NOT NULL DEFAULT 'pending',
  status      text NOT NULL DEFAULT 'pending',
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  used_at     timestamptz,
  used_by     uuid
);

CREATE INDEX invitations_email_status_idx
  ON public.invitations (lower(email), status);

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage invitations"
  ON public.invitations
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'super_admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY "Anyone can read invitation by token"
  ON public.invitations
  FOR SELECT TO anon, authenticated
  USING (true);

CREATE OR REPLACE FUNCTION public.handle_invitation_signup()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _invitation RECORD;
BEGIN
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO _invitation
  FROM public.invitations
  WHERE lower(email) = lower(NEW.email)
    AND status = 'pending'
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.user_roles
       SET role = _invitation.role
     WHERE user_id = NEW.id;

    UPDATE public.profiles
       SET display_name = COALESCE(
             NULLIF(trim(_invitation.first_name || ' ' || _invitation.last_name), ''),
             display_name
           )
     WHERE user_id = NEW.id;

    UPDATE public.invitations
       SET status = 'used',
           used_at = now(),
           used_by = NEW.id
     WHERE id = _invitation.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_invitation_claim ON auth.users;
CREATE TRIGGER on_auth_user_invitation_claim
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_invitation_signup();
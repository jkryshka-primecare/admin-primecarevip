-- Allow-list of email domains permitted to sign up
CREATE TABLE public.allowed_signup_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL UNIQUE,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

-- Store domains case-insensitively to avoid duplicates like Foo.com / foo.com
CREATE OR REPLACE FUNCTION public.normalize_signup_domain()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.domain := lower(trim(NEW.domain));
  IF NEW.domain IS NULL OR NEW.domain = '' OR position('.' in NEW.domain) = 0 THEN
    RAISE EXCEPTION 'Invalid domain: %', NEW.domain;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_normalize_signup_domain
BEFORE INSERT OR UPDATE ON public.allowed_signup_domains
FOR EACH ROW EXECUTE FUNCTION public.normalize_signup_domain();

ALTER TABLE public.allowed_signup_domains ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read allowed domains"
ON public.allowed_signup_domains FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage allowed domains"
ON public.allowed_signup_domains FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed with production domain + the existing test domain so we don't
-- lock out the test admin account already in auth.users.
INSERT INTO public.allowed_signup_domains (domain, notes) VALUES
  ('primecarevip.com', 'Production staff domain'),
  ('primecarevip.test', 'Sandbox / QA test accounts')
ON CONFLICT (domain) DO NOTHING;

-- Trigger on auth.users that blocks signups from disallowed domains.
-- SECURITY DEFINER so it can read the public allow-list regardless of
-- the caller's role (signup runs as the anon role).
CREATE OR REPLACE FUNCTION public.enforce_allowed_signup_domain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  email_domain text;
  is_allowed boolean;
BEGIN
  IF NEW.email IS NULL THEN
    RETURN NEW; -- phone signups, service accounts, etc.
  END IF;

  email_domain := lower(split_part(NEW.email, '@', 2));
  IF email_domain = '' THEN
    RAISE EXCEPTION 'Invalid email address'
      USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.allowed_signup_domains
    WHERE domain = email_domain
  ) INTO is_allowed;

  IF NOT is_allowed THEN
    RAISE EXCEPTION 'Sign-ups are restricted to approved Prime Care VIP email domains. Contact your administrator to request access for "%".', email_domain
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_allowed_signup_domain ON auth.users;
CREATE TRIGGER trg_enforce_allowed_signup_domain
BEFORE INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.enforce_allowed_signup_domain();
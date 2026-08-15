CREATE OR REPLACE FUNCTION public.deny_bridge_account_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id = 'c85a8977-1fa6-40c5-a819-decdf43e7177'::uuid THEN
    RAISE EXCEPTION 'The portal WIF bridge account is a machine identity and cannot hold any role';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deny_bridge_account_roles ON public.user_roles;
CREATE TRIGGER deny_bridge_account_roles
  BEFORE INSERT OR UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.deny_bridge_account_roles();

DELETE FROM public.user_roles WHERE user_id = 'c85a8977-1fa6-40c5-a819-decdf43e7177'::uuid;
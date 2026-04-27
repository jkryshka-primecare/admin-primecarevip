-- Extend handle_invitation_signup to also link hr_employees.user_id by email match.
CREATE OR REPLACE FUNCTION public.handle_invitation_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  -- Auto-link an existing hr_employees row by email (whether or not an invitation existed).
  UPDATE public.hr_employees
     SET user_id = NEW.id
   WHERE lower(email) = lower(NEW.email)
     AND user_id IS NULL;

  RETURN NEW;
END;
$function$;
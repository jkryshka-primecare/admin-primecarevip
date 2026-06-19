
-- 1. Invitations: drop public-read policy
DROP POLICY IF EXISTS "Anyone can read invitation by token" ON public.invitations;

-- 2. hr-avatars storage: scope SELECT to HR managers or the avatar owner
DROP POLICY IF EXISTS "Auth read hr-avatars by name" ON storage.objects;
CREATE POLICY "HR or owner read hr-avatars"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'hr-avatars'
  AND (
    public.is_hr_manager(auth.uid())
    OR (storage.foldername(name))[1] = (public.current_employee_id())::text
  )
);

-- 3. phi_access_log: explicit deny on client INSERT/UPDATE/DELETE
CREATE POLICY "No client inserts to phi_access_log"
ON public.phi_access_log
FOR INSERT
TO authenticated, anon
WITH CHECK (false);

CREATE POLICY "No client updates to phi_access_log"
ON public.phi_access_log
FOR UPDATE
TO authenticated, anon
USING (false)
WITH CHECK (false);

CREATE POLICY "No client deletes from phi_access_log"
ON public.phi_access_log
FOR DELETE
TO authenticated, anon
USING (false);

-- 4. Revoke EXECUTE on SECURITY DEFINER functions that should never be
--    invoked over the Data API. Trigger functions and email-queue helpers
--    are server-/trigger-only.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.handle_invitation_signup() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.sync_pto_used_on_request() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM anon, authenticated, public;

-- Role-check helpers are needed by RLS for signed-in users only; remove anon.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_staff(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_hr_admin(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_hr_manager(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_employee_manager_of(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.current_employee_id() FROM anon, public;

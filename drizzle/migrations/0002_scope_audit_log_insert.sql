DROP POLICY IF EXISTS "Authenticated insert audit_log" ON public.audit_log;
CREATE POLICY "Staff insert own audit_log" ON public.audit_log
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() AND public.is_staff(auth.uid()));

UPDATE storage.buckets SET public = false WHERE id = 'hr-avatars';

-- Re-assert search_path on HR helper functions (already set, but linter wants explicit ALTER FUNCTION style for clarity)
ALTER FUNCTION public.is_hr_manager(uuid) SET search_path = public;
ALTER FUNCTION public.is_hr_admin(uuid) SET search_path = public;
ALTER FUNCTION public.is_employee_manager_of(uuid, uuid) SET search_path = public;
ALTER FUNCTION public.current_employee_id() SET search_path = public;

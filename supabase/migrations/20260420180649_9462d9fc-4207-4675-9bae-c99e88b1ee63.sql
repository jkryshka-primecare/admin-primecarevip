-- Confirm test admin email and promote to admin role for end-to-end verification
UPDATE auth.users
SET email_confirmed_at = now()
WHERE email = 'testadmin+pcvip@primecarevip.test';

-- Replace 'pending' role with 'admin'
DELETE FROM public.user_roles
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'testadmin+pcvip@primecarevip.test')
  AND role = 'pending';

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role FROM auth.users WHERE email = 'testadmin+pcvip@primecarevip.test'
ON CONFLICT (user_id, role) DO NOTHING;
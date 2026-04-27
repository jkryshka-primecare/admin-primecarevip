-- 1) Pin search_path on email queue helpers
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public, pgmq;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public, pgmq;
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public, pgmq;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public, pgmq;

-- 2) Tighten public storage listing for email-assets bucket.
-- Drop any broad SELECT policies that allow anonymous listing of all files.
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT polname
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'storage'
      AND c.relname = 'objects'
      AND p.polcmd = 'r'
      AND pg_get_expr(p.polqual, p.polrelid) ILIKE '%email-assets%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.polname);
  END LOOP;
END$$;

-- Allow only the service role to list/read via storage API.
-- Direct public URL fetches still work because they go through the storage CDN
-- using the bucket's `public = true` flag, not via this RLS policy.
CREATE POLICY "email-assets service role read"
ON storage.objects
FOR SELECT
TO service_role
USING (bucket_id = 'email-assets');

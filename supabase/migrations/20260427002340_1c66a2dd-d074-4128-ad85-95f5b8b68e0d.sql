
-- Replace broad public SELECT with one that only returns rows when the
-- caller already knows the exact object name (i.e. they have the URL).
-- Public CDN fetch via getPublicUrl still works because it bypasses RLS at
-- the storage edge, but RLS-based LIST queries no longer return everything.
DROP POLICY IF EXISTS "Public read hr-avatars" ON storage.objects;

-- Authenticated users may read (needed for signed flows / app UI fetch by name).
CREATE POLICY "Auth read hr-avatars by name"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'hr-avatars');

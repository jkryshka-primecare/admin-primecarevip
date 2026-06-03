ALTER TABLE public.providers ALTER COLUMN specialty_id DROP NOT NULL;
ALTER TABLE public.providers ALTER COLUMN city DROP NOT NULL;
ALTER TABLE public.providers ALTER COLUMN state DROP NOT NULL;
ALTER TABLE public.providers ALTER COLUMN phone DROP NOT NULL;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS fax text;
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS categories text[] NOT NULL DEFAULT '{}';
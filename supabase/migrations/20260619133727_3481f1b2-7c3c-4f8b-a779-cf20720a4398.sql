
ALTER TABLE public.providers ADD COLUMN IF NOT EXISTS network text;
CREATE INDEX IF NOT EXISTS providers_network_idx ON public.providers (network);

ALTER TABLE public.import_jobs ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'url';
ALTER TABLE public.import_jobs ADD COLUMN IF NOT EXISTS file_path text;
ALTER TABLE public.import_jobs ADD COLUMN IF NOT EXISTS network text;
ALTER TABLE public.import_jobs ALTER COLUMN url DROP NOT NULL;

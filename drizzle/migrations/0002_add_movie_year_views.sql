ALTER TABLE public.movies ADD COLUMN IF NOT EXISTS year integer;
ALTER TABLE public.movies ADD COLUMN IF NOT EXISTS views_count integer NOT NULL DEFAULT 0;
CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.categories TO anon, authenticated;
GRANT ALL ON public.categories TO service_role;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can view categories" ON public.categories FOR SELECT TO anon, authenticated USING (true);
INSERT INTO public.categories (name, position)
SELECT category, (row_number() OVER (ORDER BY category))::int - 1
FROM (SELECT DISTINCT category FROM public.movies WHERE category <> '') s;
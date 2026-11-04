-- Guarda até onde cada visitante assistiu cada filme, para continuar de onde parou.
CREATE TABLE public.watch_progress (
  device_id uuid NOT NULL,
  movie_id uuid NOT NULL REFERENCES public.movies(id) ON DELETE CASCADE,
  position_seconds double precision NOT NULL DEFAULT 0,
  duration_seconds double precision NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, movie_id)
);

GRANT ALL ON public.watch_progress TO service_role;

ALTER TABLE public.watch_progress ENABLE ROW LEVEL SECURITY;

-- Acesso somente por funções próprias: sem política para anon, ninguém consegue
-- ler a tabela direto pela API, apenas gravar/ler a própria lista pelo device_id.

CREATE OR REPLACE FUNCTION public.save_watch_progress(
  p_device uuid, p_movie uuid, p_position_seconds double precision, p_duration_seconds double precision
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_duration_seconds IS NULL OR p_duration_seconds <= 0 OR p_position_seconds IS NULL OR p_position_seconds < 0 THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.movies WHERE id = p_movie) THEN
    RETURN;
  END IF;
  -- Filme quase no fim: some da lista de "continuar assistindo".
  IF p_position_seconds >= p_duration_seconds - 30 THEN
    DELETE FROM public.watch_progress WHERE device_id = p_device AND movie_id = p_movie;
    RETURN;
  END IF;
  INSERT INTO public.watch_progress (device_id, movie_id, position_seconds, duration_seconds, updated_at)
  VALUES (p_device, p_movie, p_position_seconds, p_duration_seconds, now())
  ON CONFLICT (device_id, movie_id)
  DO UPDATE SET position_seconds = EXCLUDED.position_seconds, duration_seconds = EXCLUDED.duration_seconds, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.list_watch_progress(p_device uuid)
RETURNS TABLE (movie_id uuid, position_seconds double precision, duration_seconds double precision, updated_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT w.movie_id, w.position_seconds, w.duration_seconds, w.updated_at
  FROM public.watch_progress w
  WHERE w.device_id = p_device
  ORDER BY w.updated_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.clear_watch_progress(p_device uuid, p_movie uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM public.watch_progress WHERE device_id = p_device AND movie_id = p_movie;
$$;

REVOKE EXECUTE ON FUNCTION public.save_watch_progress(uuid, uuid, double precision, double precision) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_watch_progress(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.clear_watch_progress(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.save_watch_progress(uuid, uuid, double precision, double precision) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_watch_progress(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clear_watch_progress(uuid, uuid) TO anon, authenticated, service_role;
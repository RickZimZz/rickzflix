-- RickZFlix: adiciona somente o ano de lançamento dos filmes.
alter table public.movies
  add column if not exists year integer;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'movies_year_range'
      and conrelid = 'public.movies'::regclass
  ) then
    alter table public.movies
      add constraint movies_year_range
      check (year is null or year between 1888 and 2100);
  end if;
end
$$;

-- Atualiza o cache de esquema usado pela API do Supabase.
notify pgrst, 'reload schema';

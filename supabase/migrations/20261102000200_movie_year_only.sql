-- RickZFlix: adiciona somente o ano de lançamento dos filmes.
alter table public.movies
  add column if not exists year integer;

alter table public.movies
  add constraint movies_year_range
  check (year is null or year between 1888 and 2100);

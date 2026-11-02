-- RickZFlix: release year and unique per-browser movie view counts.
alter table public.movies
  add column if not exists year integer,
  add column if not exists views_count bigint not null default 0;

create table if not exists public.movie_views (
  movie_id uuid not null references public.movies(id) on delete cascade,
  visitor_id text not null,
  created_at timestamptz not null default now(),
  primary key (movie_id, visitor_id)
);

alter table public.movie_views enable row level security;
revoke all on table public.movie_views from anon, authenticated;

create or replace function public.register_movie_view(
  p_movie_id uuid,
  p_visitor_id text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_rows integer;
  current_views bigint;
begin
  if p_visitor_id is null or length(p_visitor_id) < 8 or length(p_visitor_id) > 128 then
    raise exception 'Invalid visitor identifier';
  end if;

  insert into public.movie_views (movie_id, visitor_id)
  values (p_movie_id, p_visitor_id)
  on conflict (movie_id, visitor_id) do nothing;

  get diagnostics inserted_rows = row_count;

  if inserted_rows > 0 then
    update public.movies
      set views_count = views_count + 1
      where id = p_movie_id
      returning views_count into current_views;
  else
    select views_count into current_views
      from public.movies
      where id = p_movie_id;
  end if;

  if current_views is null then
    raise exception 'Movie not found';
  end if;

  return current_views;
end;
$$;

revoke all on function public.register_movie_view(uuid, text) from public;
grant execute on function public.register_movie_view(uuid, text) to anon, authenticated;

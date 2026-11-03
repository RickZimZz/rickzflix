create table if not exists public.movie_reports (
  id uuid primary key default gen_random_uuid(),
  movie_id uuid not null references public.movies(id) on delete cascade,
  movie_title text not null,
  created_at timestamptz not null default now()
);

create index if not exists movie_reports_created_at_idx
  on public.movie_reports (created_at desc);

alter table public.movie_reports enable row level security;

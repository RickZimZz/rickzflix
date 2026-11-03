-- Registro da última falha de reprodução por filme.
create table if not exists public.playback_failures (
  movie_id uuid primary key references public.movies(id) on delete cascade,
  failed_at timestamptz not null default now()
);

alter table public.playback_failures enable row level security;

drop policy if exists "Public can report playback failures" on public.playback_failures;
create policy "Public can report playback failures"
  on public.playback_failures for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Public can update playback failures" on public.playback_failures;
create policy "Public can update playback failures"
  on public.playback_failures for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "Public can read playback failures" on public.playback_failures;
create policy "Public can read playback failures"
  on public.playback_failures for select
  to anon, authenticated
  using (true);

notify pgrst, 'reload schema';

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { addMovie, deleteMovie, verifyAdmin } from "@/lib/movies.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "RickzFlix — Seus filmes" },
      { name: "description", content: "Assista aos filmes da coleção RickzFlix, organizados por categoria." },
      { property: "og:title", content: "RickzFlix — Seus filmes" },
      { property: "og:description", content: "Assista aos filmes da coleção RickzFlix, organizados por categoria." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Movie = {
  id: string;
  title: string;
  cover_url: string;
  video_url: string;
  category: string;
  description: string;
  rating: string;
};

const RATINGS = ["Livre", "10", "12", "14", "16", "18"];

function embedUrl(url: string) {
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  if (yt) return { type: "iframe" as const, src: `https://www.youtube.com/embed/${yt[1]}?autoplay=1` };
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return { type: "iframe" as const, src: `https://player.vimeo.com/video/${vimeo[1]}?autoplay=1` };
  const gd = url.match(/drive\.google\.com\/file\/d\/([\w-]+)/);
  if (gd) return { type: "iframe" as const, src: `https://drive.google.com/file/d/${gd[1]}/preview` };
  return { type: "video" as const, src: url };
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
  );
}

function RatingBadge({ r }: { r: string }) {
  return <span className="rating-badge" data-rating={r}>{r === "Livre" ? "L" : r}</span>;
}

function Index() {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState<Movie | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [filter, setFilter] = useState("Todos");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [dark, setDark] = useState(true);
  useEffect(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "light") setDark(false);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  const load = async () => {
    const { data } = await supabase.from("movies").select("*").order("created_at", { ascending: false });
    setMovies((data as Movie[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const categories = useMemo(() => ["Todos", ...Array.from(new Set(movies.map((m) => m.category)))], [movies]);
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = movies.filter((m) => (filter === "Todos" || m.category === filter) && (!q || m.title.toLowerCase().includes(q)));
    if (filter !== "Todos" || q) return list.length ? [[filter === "Todos" ? "Resultados" : filter, list] as [string, Movie[]]] : [];
    const map = new Map<string, Movie[]>();
    list.forEach((m) => map.set(m.category, [...(map.get(m.category) ?? []), m]));
    return Array.from(map.entries());
  }, [movies, filter, query]);
  const showHero = filter === "Todos" && !query.trim();
  const featured = showHero ? movies[0] : undefined;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="fixed inset-x-0 top-0 z-30 flex items-center justify-between px-5 py-4 md:px-10 bg-gradient-to-b from-background to-transparent">
        <h1 className="font-display text-3xl tracking-wider text-primary">RICKZFLIX</h1>
        <div className="flex items-center gap-2">
          {searchOpen && (
            <input autoFocus className="field h-9 w-40 py-1 sm:w-56" placeholder="Buscar filme…" value={query} onChange={(e) => setQuery(e.target.value)} />
          )}
          <button className="icon-btn" aria-label="Pesquisar" onClick={() => { if (searchOpen) setQuery(""); setSearchOpen(!searchOpen); }}>
            {searchOpen ? "✕" : <SearchIcon />}
          </button>
          <button className="icon-btn" aria-label="Alternar tema" onClick={() => setDark(!dark)}>{dark ? "☀" : "☾"}</button>
          <button className="btn-ghost" onClick={() => setAdminOpen(true)}>Admin</button>
        </div>
      </header>

      {featured ? (
        <section className="relative flex h-[70vh] min-h-[420px] items-end">
          <img src={featured.cover_url} alt={featured.title} className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 hero-fade" />
          <div className="relative z-10 max-w-2xl px-5 pb-12 md:px-10">
            <div className="mb-3 flex items-center gap-3 text-sm text-muted-foreground">
              <RatingBadge r={featured.rating} /> <span>{featured.category}</span>
            </div>
            <h2 className="font-display text-5xl leading-none md:text-7xl">{featured.title}</h2>
            <p className="mt-4 line-clamp-3 text-muted-foreground">{featured.description}</p>
            <button className="btn-primary mt-6" onClick={() => setPlaying(featured)}>▶ Assistir</button>
          </div>
        </section>
      ) : !showHero ? (
        <div className="h-20" />
      ) : (
        <section className="flex h-[60vh] flex-col items-center justify-center px-6 pt-20 text-center">
          <h2 className="font-display text-5xl md:text-7xl">{loading ? "Carregando…" : "Nenhum filme ainda"}</h2>
          {!loading && <p className="mt-3 text-muted-foreground">Entre como administrador para adicionar o primeiro filme.</p>}
        </section>
      )}

      {movies.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-5 py-6 md:px-10">
          {categories.map((c) => (
            <button key={c} onClick={() => setFilter(c)} className={c === filter ? "chip chip-active" : "chip"}>{c}</button>
          ))}
        </div>
      )}

      <main className="space-y-10 pb-16">
        {!loading && movies.length > 0 && grouped.length === 0 && (
          <p className="px-5 text-muted-foreground md:px-10">Nenhum filme encontrado.</p>
        )}
        {grouped.map(([cat, list]) => (
          <section key={cat}>
            <h3 className="px-5 font-display text-2xl tracking-wide md:px-10">{cat}</h3>
            <div className={showHero ? "mt-3 flex gap-4 overflow-x-auto px-5 pb-2 md:px-10" : "mt-3 grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-4 px-5 md:grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] md:px-10"}>
              {list.map((m) => (
                <button key={m.id} onClick={() => setPlaying(m)} className={showHero ? "movie-card group" : "movie-card movie-card-grid group"}>
                  <img src={m.cover_url} alt={m.title} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                  <div className="movie-card-info">
                    <div className="flex items-center gap-2"><RatingBadge r={m.rating} /></div>
                    <p className="mt-1 text-left text-sm font-semibold">{m.title}</p>
                  </div>
                </button>
              ))}
            </div>
          </section>
        ))}
      </main>

      {playing && <Player movie={playing} movies={movies} onClose={() => setPlaying(null)} onPick={setPlaying} />}
      {adminOpen && <AdminPanel movies={movies} onClose={() => setAdminOpen(false)} onChange={load} />}
    </div>
  );
}

function fmt(t: number) {
  if (!isFinite(t)) return "0:00";
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = Math.floor(t % 60);
  const ss = String(sec).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function VideoPlayer({ src }: { src: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const vid = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [muted, setMuted] = useState(false);
  const toggle = () => { const v = vid.current; if (!v) return; v.paused ? v.play() : v.pause(); };
  const skip = (d: number) => { const v = vid.current; if (v) v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + d)); };
  const full = () => { if (document.fullscreenElement) document.exitFullscreen(); else wrap.current?.requestFullscreen(); };
  return (
    <div ref={wrap} className="player-wrap group">
      <video ref={vid} src={src} autoPlay playsInline className="h-full w-full bg-background" onClick={toggle}
        onPlay={() => setPaused(false)} onPause={() => setPaused(true)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setDur(e.currentTarget.duration)} />
      <div className="player-controls">
        <input type="range" min={0} max={dur || 0} step={0.1} value={time} className="player-range"
          onChange={(e) => { if (vid.current) vid.current.currentTime = Number(e.target.value); }} />
        <div className="flex items-center gap-2">
          <button className="player-btn" onClick={() => skip(-10)} aria-label="Voltar 10s">↺10</button>
          <button className="player-btn player-btn-main" onClick={toggle} aria-label={paused ? "Reproduzir" : "Pausar"}>{paused ? "▶" : "❚❚"}</button>
          <button className="player-btn" onClick={() => skip(10)} aria-label="Avançar 10s">10↻</button>
          <button className="player-btn" onClick={() => { if (vid.current) { vid.current.muted = !muted; setMuted(!muted); } }} aria-label="Som">{muted ? "🔇" : "🔊"}</button>
          <span className="ml-1 text-xs tabular-nums">{fmt(time)} / {fmt(dur)}</span>
          <button className="player-btn ml-auto" onClick={full} aria-label="Tela cheia">⛶</button>
        </div>
      </div>
    </div>
  );
}

function Player({ movie, movies, onClose, onPick }: { movie: Movie; movies: Movie[]; onClose: () => void; onPick: (m: Movie) => void }) {
  const e = embedUrl(movie.video_url);
  const suggestions = useMemo(
    () => movies.filter((m) => m.id !== movie.id).sort(() => Math.random() - 0.5).slice(0, 8),
    [movie.id, movies],
  );
  return (
    <div className="modal-backdrop items-start" onClick={onClose}>
      <div className="my-6 w-full max-w-5xl" onClick={(ev) => ev.stopPropagation()}>
        <div className="mb-3 flex justify-end"><button className="btn-ghost" onClick={onClose}>Fechar ✕</button></div>
        {e.type === "iframe" ? (
          <div className="aspect-video w-full overflow-hidden rounded-lg bg-card">
            <iframe key={movie.id} src={e.src} className="h-full w-full" allow="autoplay; fullscreen; encrypted-media" allowFullScreen title={movie.title} />
          </div>
        ) : (
          <VideoPlayer key={movie.id} src={e.src} />
        )}
        <div className="mt-5">
          <div className="flex items-center gap-3"><RatingBadge r={movie.rating} /><span className="text-sm text-muted-foreground">{movie.category}</span></div>
          <h2 className="mt-2 font-display text-4xl leading-none">{movie.title}</h2>
          {movie.description && <p className="mt-3 max-w-3xl text-muted-foreground">{movie.description}</p>}
        </div>
        {suggestions.length > 0 && (
          <div className="mt-8">
            <h3 className="font-display text-2xl tracking-wide">Você também pode gostar</h3>
            <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3">
              {suggestions.map((m) => (
                <button key={m.id} onClick={() => onPick(m)} className="movie-card movie-card-grid group">
                  <img src={m.cover_url} alt={m.title} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                  <div className="movie-card-info"><RatingBadge r={m.rating} /><p className="mt-1 text-left text-sm font-semibold">{m.title}</p></div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AdminPanel({ movies, onClose, onChange }: { movies: Movie[]; onClose: () => void; onChange: () => void }) {
  const [password, setPassword] = useState("");
  const [authed, setAuthed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const empty = { title: "", cover_url: "", video_url: "", category: "", description: "", rating: "Livre" };
  const [form, setForm] = useState(empty);
  const [adminQuery, setAdminQuery] = useState("");
  const adminList = movies.filter((m) => m.title.toLowerCase().includes(adminQuery.trim().toLowerCase()) || m.category.toLowerCase().includes(adminQuery.trim().toLowerCase()));

  const login = async (e: React.FormEvent) => {
    e.preventDefault(); setError(""); setBusy(true);
    try { await verifyAdmin({ data: { password } }); setAuthed(true); }
    catch { setError("Senha incorreta"); }
    setBusy(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(""); setBusy(true);
    try { await addMovie({ data: { ...form, password } }); setForm(empty); onChange(); }
    catch { setError("Não foi possível salvar. Verifique se os links são válidos (começando com https://)."); }
    setBusy(false);
  };

  const remove = async (id: string) => {
    if (!confirm("Remover este filme?")) return;
    await deleteMovie({ data: { id, password } }); onChange();
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-3xl tracking-wide">Administrador</h2>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>
        {!authed ? (
          <form onSubmit={login} className="space-y-4">
            <label className="field-label">Senha</label>
            <input type="password" className="field" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button className="btn-primary w-full" disabled={busy}>Entrar</button>
          </form>
        ) : (
          <>
            <form onSubmit={submit} className="space-y-3">
              <div><label className="field-label">Nome do filme</label><input required className="field" value={form.title} onChange={set("title")} /></div>
              <div><label className="field-label">Capa (link da imagem)</label><input required type="url" placeholder="https://..." className="field" value={form.cover_url} onChange={set("cover_url")} /></div>
              <div><label className="field-label">Link do vídeo</label><input required type="url" placeholder="YouTube, Vimeo, Google Drive ou .mp4" className="field" value={form.video_url} onChange={set("video_url")} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="field-label">Categoria</label><input required list="cats" className="field" value={form.category} onChange={set("category")} />
                  <datalist id="cats">{Array.from(new Set(movies.map((m) => m.category))).map((c) => <option key={c} value={c} />)}</datalist></div>
                <div><label className="field-label">Classificação</label>
                  <select className="field" value={form.rating} onChange={set("rating")}>{RATINGS.map((r) => <option key={r} value={r}>{r === "Livre" ? "Livre" : `${r} anos`}</option>)}</select></div>
              </div>
              <div><label className="field-label">Descrição</label><textarea rows={3} className="field" value={form.description} onChange={set("description")} /></div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <button className="btn-primary w-full" disabled={busy}>{busy ? "Salvando…" : "Adicionar filme"}</button>
            </form>
            {movies.length > 0 && (
              <div className="mt-6">
                <h3 className="field-label">Filmes cadastrados ({movies.length})</h3>
                <input className="field mb-2" placeholder="Pesquisar nos filmes cadastrados…" value={adminQuery} onChange={(e) => setAdminQuery(e.target.value)} />
                <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {adminList.length === 0 && <p className="text-sm text-muted-foreground">Nenhum filme encontrado.</p>}
                {adminList.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 rounded-md bg-secondary p-2">
                    <img src={m.cover_url} alt="" className="h-12 w-9 rounded object-cover" />
                    <div className="min-w-0 flex-1"><p className="truncate text-sm">{m.title}</p><p className="truncate text-xs text-muted-foreground">{m.category} · {m.rating === "Livre" ? "Livre" : `${m.rating} anos`}</p></div>
                    <button className="text-sm text-destructive" onClick={() => remove(m.id)}>Remover</button>
                  </div>
                ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

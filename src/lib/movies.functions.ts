import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
function isPublicAddress(address: string, isIP: (value: string) => number) {
  if (isIP(address) === 4) {
    const parts = address.split(".").map(Number);
    const [a = 0, b = 0, c = 0] = parts;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0 && c === 113));
  }
  // Only allow globally-routable IPv6 addresses; reject local, mapped and special ranges.
  return isIP(address) === 6 && /^2|^3/.test(address);
}

async function assertPublicUrl(rawUrl: string) {
  const { lookup } = await import("node:dns/promises");
  const { isIP } = await import("node:net");
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("URL não permitida para verificação");
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || isIP(host)) {
    throw new Error("Endereço não público");
  }
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address, isIP))) {
    throw new Error("Destino não público");
  }
  return url;
}

async function requestVideoStatus(rawUrl: string) {
  let current = rawUrl;
  for (let redirect = 0; redirect <= 4; redirect++) {
    const url = await assertPublicUrl(current);
    // Testa uma requisição GET real (com Range), não apenas HEAD.
    // Alguns hosts respondem HEAD 200 mesmo quando o arquivo não pode ser entregue.
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
      headers: {
        range: "bytes=0-8191",
        "user-agent": "Mozilla/5.0 (compatible; RickZFlix-Link-Checker/1.0)",
        accept: "video/*,application/vnd.apple.mpegurl,application/x-mpegURL,application/dash+xml,*/*;q=0.8",
      },
    }).catch(() => null);

    if (!response) {
      return { status: "unknown" as const, message: "O servidor não entregou o arquivo para teste" };
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location || redirect === 4) {
        return { status: "unknown" as const, message: "Redirecionamento não verificável" };
      }
      current = new URL(location, url).toString();
      continue;
    }

    if ([404, 410].includes(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      return { status: "expired" as const, message: `Link indisponível (HTTP ${response.status})` };
    }
    if ([401, 403].includes(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      return { status: "warning" as const, message: "Acesso bloqueado ou exige permissão" };
    }
    if (response.status >= 500) {
      await response.body?.cancel().catch(() => undefined);
      return { status: "warning" as const, message: `Servidor com erro (HTTP ${response.status})` };
    }
    if (response.status < 200 || response.status >= 300) {
      await response.body?.cancel().catch(() => undefined);
      return { status: "warning" as const, message: `Resposta HTTP ${response.status}` };
    }

    // Lê apenas o primeiro bloco para confirmar a entrega, sem baixar o vídeo.
    // O timeout de 5s e o Range pequeno deixam a verificação mais rápida.
    // Não exige Content-Type video/* porque alguns hosts usam application/octet-stream.
    const reader = response.body?.getReader();
    if (!reader) {
      return { status: "warning" as const, message: "O servidor respondeu, mas não entregou o arquivo" };
    }

    let bytesRead = 0;
    let readFailed = false;
    try {
      const chunk = await reader.read();
      if (!chunk.done) bytesRead = chunk.value?.byteLength ?? 0;
    } catch {
      readFailed = true;
    } finally {
      await reader.cancel().catch(() => undefined);
    }

    if (readFailed) {
      return { status: "warning" as const, message: "Falha ao receber os dados do arquivo" };
    }
    if (bytesRead === 0) {
      return { status: "warning" as const, message: "O servidor respondeu, mas não entregou dados do arquivo" };
    }

    return {
      status: "ok" as const,
      message: `Arquivo acessível: ${bytesRead} bytes recebidos (HTTP ${response.status})`,
    };
  }
  return { status: "unknown" as const, message: "Não foi possível seguir o link" };
}

export const checkMovieLinks = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({
    password: z.string().max(200),
    movies: z.array(z.object({ id: z.string().uuid(), video_url: z.string().url().max(2000) })).max(300),
  }).parse(d))
  .handler(async ({ data }) => {
    checkPassword(data.password);
    const results: Array<{ id: string; status: "ok" | "expired" | "warning" | "unknown"; message: string }> = [];
    for (let i = 0; i < data.movies.length; i += 20) {
      const batch = data.movies.slice(i, i + 20);
      const checked = await Promise.all(batch.map(async (movie) => {
        try {
          return { id: movie.id, ...(await requestVideoStatus(movie.video_url)) };
        } catch (error) {
          return { id: movie.id, status: "unknown" as const, message: error instanceof Error ? error.message : "Não foi possível verificar" };
        }
      }));
      results.push(...checked);
    }
    return { results, checkedAt: new Date().toISOString() };
  });


function checkPassword(pw: string) {
  const expected = process.env["ADMIN_PASSWORD"];
  if (!expected || pw !== expected) throw new Error("Senha incorreta");
}

export const verifyAdmin = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ password: z.string().max(200) }).parse(d))
  .handler(async ({ data }) => {
    checkPassword(data.password);
    return { ok: true };
  });

const movieSchema = z.object({
  password: z.string().max(200),
  title: z.string().trim().min(1).max(200),
  cover_url: z.string().trim().url().max(2000),
  video_url: z.string().trim().url().max(2000),
  category: z.string().trim().max(100),
  description: z.string().trim().max(3000),
  rating: z.string().trim().min(1).max(20),
  year: z.number().int().min(1888).max(2100).nullable(),
});

export const addMovie = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => movieSchema.parse(d))
  .handler(async ({ data }) => {
    checkPassword(data.password);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { password: _p, ...movie } = data;
    const { error } = await supabaseAdmin.from("movies").insert(movie);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateMovie = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    movieSchema.extend({ id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    checkPassword(data.password);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { password: _p, id, ...movie } = data;
    const { error } = await supabaseAdmin.from("movies").update(movie).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteMovie = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ password: z.string().max(200), id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    checkPassword(data.password);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("movies").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const addCategory = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ password: z.string().max(200), name: z.string().trim().min(1).max(100) }).parse(d))
  .handler(async ({ data }) => {
    checkPassword(data.password);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: last } = await supabaseAdmin.from("categories").select("position").order("position", { ascending: false }).limit(1);
    const position = (last?.[0]?.position ?? -1) + 1;
    const { error } = await supabaseAdmin.from("categories").insert({ name: data.name, position });
    if (error) throw new Error(error.code === "23505" ? "Essa categoria já existe" : error.message);
    return { ok: true };
  });

export const reorderCategories = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ password: z.string().max(200), ids: z.array(z.string().uuid()).max(500) }).parse(d))
  .handler(async ({ data }) => {
    checkPassword(data.password);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    for (let i = 0; i < data.ids.length; i++) {
      const { error } = await supabaseAdmin.from("categories").update({ position: i }).eq("id", data.ids[i]!);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const deleteCategory = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ password: z.string().max(200), id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    checkPassword(data.password);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: cat, error: e1 } = await supabaseAdmin.from("categories").select("name").eq("id", data.id).single();
    if (e1 || !cat) throw new Error("Categoria não encontrada");
    // Movies of a deleted category become uncategorized (shown only under "Todos").
    const { error: e2 } = await supabaseAdmin.from("movies").update({ category: "" }).eq("category", cat.name);
    if (e2) throw new Error(e2.message);
    const { error } = await supabaseAdmin.from("categories").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


export const reportMovieIssue = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ movieId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: movie, error: movieError } = await supabaseAdmin
      .from("movies")
      .select("id,title")
      .eq("id", data.movieId)
      .single();
    if (movieError || !movie) throw new Error("Filme não encontrado");

    const { error } = await supabaseAdmin.from("movie_reports").insert({
      movie_id: movie.id,
      movie_title: movie.title,
    });
    if (error) throw new Error("Não foi possível enviar o reporte");
    return { ok: true };
  });

export const getMovieReports = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ password: z.string().max(200) }).parse(d))
  .handler(async ({ data }) => {
    checkPassword(data.password);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: reports, error } = await supabaseAdmin
      .from("movie_reports")
      .select("id,movie_id,movie_title,created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error("Não foi possível carregar os reportes");
    return { reports: reports ?? [] };
  });

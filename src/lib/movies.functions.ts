import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
function isPublicAddress(address: string, isIP: (value: string) => number) {
  if (isIP(address) === 4) {
    const parts = address.split(".").map(Number);
    const [a, b, c] = parts;
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
    let response = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(7000),
      headers: { "user-agent": "RickZFlix-Link-Checker/1.0" },
    }).catch(() => null);

    if (response && [301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirect === 4) return { status: "unknown" as const, message: "Redirecionamento não verificável" };
      current = new URL(location, url).toString();
      continue;
    }

    if (response && [405, 501].includes(response.status)) {
      response = await fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(7000),
        headers: { range: "bytes=0-0", "user-agent": "RickZFlix-Link-Checker/1.0" },
      }).catch(() => null);
    }

    if (!response) return { status: "unknown" as const, message: "Servidor não respondeu ou bloqueou a verificação" };
    if ([404, 410].includes(response.status)) return { status: "expired" as const, message: `Link indisponível (HTTP ${response.status})` };
    if ([401, 403].includes(response.status)) return { status: "warning" as const, message: "Acesso bloqueado ou exige permissão" };
    if (response.status >= 500) return { status: "warning" as const, message: `Servidor com erro (HTTP ${response.status})` };
    if (response.status >= 200 && response.status < 400) return { status: "ok" as const, message: "Servidor respondeu normalmente" };
    return { status: "warning" as const, message: `Resposta HTTP ${response.status}` };
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
    for (let i = 0; i < data.movies.length; i += 8) {
      const batch = data.movies.slice(i, i + 8);
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
  category: z.string().trim().min(1).max(100),
  description: z.string().trim().max(3000),
  rating: z.string().trim().min(1).max(20),
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

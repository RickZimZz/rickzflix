import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
function isAllowedHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/\\.$/, "");

  // IPs literais e nomes locais são recusados. O fetch de saída do ambiente
  // Cloudflare faz a resolução de DNS sem depender dos módulos Node.js.
  if (
    host.includes(":") ||
    host.startsWith("[") ||
    /^\\d{1,3}(?:\\.\\d{1,3}){3}$/.test(host) ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host.endsWith(".home") ||
    host.endsWith(".test") ||
    host.endsWith(".invalid") ||
    host === "metadata.google.internal"
  ) return false;

  const labels = host.split(".");
  if (labels.length < 2 || labels[labels.length - 1]!.length < 2) return false;
  return labels.every((label) =>
    label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  );
}

async function assertPublicUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !isAllowedHostname(url.hostname)
  ) {
    throw new Error("Endereço não permitido para verificação");
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

    // Confirma o tipo de conteúdo e lê somente um pequeno trecho do arquivo.
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const isRecognizedVideoType =
      contentType.startsWith("video/") ||
      contentType === "application/vnd.apple.mpegurl" ||
      contentType === "application/x-mpegurl" ||
      contentType === "application/dash+xml";
    const mayNeedSniffing =
      contentType === "application/octet-stream" ||
      contentType === "binary/octet-stream" ||
      contentType === "application/download" ||
      contentType === "text/plain" ||
      contentType === "";

    if (!isRecognizedVideoType && !mayNeedSniffing) {
      await response.body?.cancel().catch(() => undefined);
      return {
        status: "warning" as const,
        message: contentType
          ? `O link retornou conteúdo que não é vídeo (${contentType})`
          : "O servidor não informou um tipo de arquivo de vídeo",
      };
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return { status: "warning" as const, message: "O servidor respondeu, mas não entregou o arquivo" };
    }

    const chunks: Uint8Array[] = [];
    let bytesRead = 0;
    let readFailed = false;
    try {
      while (bytesRead < 8192) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (!chunk.value?.byteLength) break;
        chunks.push(chunk.value);
        bytesRead += chunk.value.byteLength;
      }
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

    const sample = new Uint8Array(Math.min(bytesRead, 8192));
    let offset = 0;
    for (const chunk of chunks) {
      sample.set(chunk.subarray(0, sample.length - offset), offset);
      offset += chunk.length;
      if (offset >= sample.length) break;
    }
    const startsWith = (...signature: number[]) =>
      signature.every((byte, index) => sample[index] === byte);
    const ascii = new TextDecoder().decode(sample.subarray(0, Math.min(sample.length, 8192))).trimStart();
    const lowerAscii = ascii.toLowerCase();
    const mp4Brand = new TextDecoder().decode(sample.subarray(4, 8));
    const isMp4 = sample.length >= 8 && mp4Brand === "ftyp";
    const isWebmOrMatroska = startsWith(0x1a, 0x45, 0xdf, 0xa3);
    const isFlv = startsWith(0x46, 0x4c, 0x56);
    const isTransportStream =
      sample.length >= 377 &&
      sample[0] === 0x47 &&
      sample[188] === 0x47 &&
      sample[376] === 0x47;
    const isHls =
      ascii.startsWith("#EXTM3U") &&
      (ascii.includes("#EXTINF") || ascii.includes("#EXT-X-"));
    const isDash = lowerAscii.includes("<mpd") && lowerAscii.includes("</mpd");
    const looksLikeVideo =
      isMp4 || isWebmOrMatroska || isFlv || isTransportStream || isHls || isDash;

    if (!looksLikeVideo) {
      return {
        status: "warning" as const,
        message: isRecognizedVideoType
          ? "O servidor informou formato de vídeo, mas a assinatura do conteúdo não pôde ser confirmada"
          : "O link respondeu, mas o conteúdo recebido não parece ser um arquivo de vídeo",
      };
    }

    return {
      status: "ok" as const,
      message: `Vídeo identificado: ${isHls ? "playlist HLS" : isDash ? "manifesto DASH" : contentType || "assinatura detectada"} · ${bytesRead} bytes recebidos (HTTP ${response.status})`,
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

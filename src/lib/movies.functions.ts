import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
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

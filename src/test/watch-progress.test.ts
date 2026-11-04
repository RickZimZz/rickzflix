import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc },
}));

import {
  clearWatchProgressInDb,
  getDeviceId,
  loadWatchProgress,
  saveWatchProgressToDb,
  writeCachedProgress,
} from "@/lib/watch-progress";

const DEVICE = "11111111-2222-3333-4444-555555555555";

describe("Posição assistida salva no banco", () => {
  beforeEach(() => {
    rpc.mockReset();
    window.localStorage.clear();
  });

  it("cria um identificador do aparelho uma vez e reaproveita depois", () => {
    const first = getDeviceId();
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(getDeviceId()).toBe(first);
  });

  it("grava a posição do filme no banco", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await saveWatchProgressToDb(DEVICE, "movie-1", 420, 5400);

    expect(rpc).toHaveBeenCalledWith("save_watch_progress", {
      p_device: DEVICE,
      p_movie: "movie-1",
      p_position_seconds: 420,
      p_duration_seconds: 5400,
    });
  });

  it("remove o filme da lista quando a pessoa terminou de assistir", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await clearWatchProgressInDb(DEVICE, "movie-1");

    expect(rpc).toHaveBeenCalledWith("clear_watch_progress", {
      p_device: DEVICE,
      p_movie: "movie-1",
    });
  });

  it("mistura o que está no aparelho com o que está no banco, valendo o mais recente", async () => {
    writeCachedProgress([
      { movieId: "older", currentTime: 100, duration: 5400, updatedAt: 1000 },
      { movieId: "stale-cache", currentTime: 10, duration: 5400, updatedAt: 1000 },
    ]);
    rpc.mockResolvedValue({
      data: [
        { movie_id: "stale-cache", position_seconds: 900, duration_seconds: 5400, updated_at: new Date(2000).toISOString() },
        { movie_id: "from-db", position_seconds: 300, duration_seconds: 5400, updated_at: new Date(3000).toISOString() },
      ],
      error: null,
    });

    const list = await loadWatchProgress(DEVICE);

    expect(list.map((item) => item.movieId)).toEqual(["from-db", "stale-cache", "older"]);
    expect(list.find((item) => item.movieId === "stale-cache")?.currentTime).toBe(900);
  });

  it("mantém a lista do aparelho se o banco não responder", async () => {
    writeCachedProgress([{ movieId: "cached", currentTime: 55, duration: 5400, updatedAt: 5000 }]);
    rpc.mockResolvedValue({ data: null, error: { message: "sem conexão" } });

    expect(await loadWatchProgress(DEVICE)).toEqual([
      { movieId: "cached", currentTime: 55, duration: 5400, updatedAt: 5000 },
    ]);
  });
});

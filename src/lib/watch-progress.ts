import { supabase } from "@/integrations/supabase/client";

export type WatchProgress = {
  movieId: string;
  currentTime: number;
  duration: number;
  updatedAt: number;
};

const DEVICE_KEY = "rickzflix-device-id";
const CACHE_KEY = "rickzflix-watch-progress";

function canStore() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

// Identifica o aparelho/navegador do visitante. Fica guardado no próprio
// navegador e é o que liga as posições salvas no banco a quem assistiu.
export function getDeviceId(): string {
  if (!canStore()) return "";
  try {
    const saved = window.localStorage.getItem(DEVICE_KEY);
    if (saved) return saved;
    const fresh =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `visitor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    return "";
  }
}

export function readCachedProgress(): WatchProgress[] {
  if (!canStore()) return [];
  try {
    const saved = window.localStorage.getItem(CACHE_KEY);
    return saved ? (JSON.parse(saved) as WatchProgress[]) : [];
  } catch {
    return [];
  }
}

export function writeCachedProgress(list: WatchProgress[]) {
  if (!canStore()) return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(list));
  } catch {
    // Sem espaço no navegador: a lista continua salva no banco.
  }
}

export async function loadWatchProgress(deviceId: string): Promise<WatchProgress[]> {
  const cached = readCachedProgress();
  if (!deviceId) return cached;
  const { data, error } = await supabase.rpc("list_watch_progress", { p_device: deviceId });
  if (error || !data) return cached;
  const remote: WatchProgress[] = data.map((row) => ({
    movieId: row.movie_id,
    currentTime: row.position_seconds,
    duration: row.duration_seconds,
    updatedAt: new Date(row.updated_at).getTime(),
  }));
  // O que estiver mais recente em cada filme vence, então a lista não some
  // quando o banco ainda está vazio ou quando o cache local está atrasado.
  const merged = new Map<string, WatchProgress>();
  [...cached, ...remote].forEach((item) => {
    const previous = merged.get(item.movieId);
    if (!previous || item.updatedAt > previous.updatedAt) merged.set(item.movieId, item);
  });
  const list = Array.from(merged.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  writeCachedProgress(list);
  return list;
}

export async function saveWatchProgressToDb(
  deviceId: string,
  movieId: string,
  currentTime: number,
  duration: number,
) {
  if (!deviceId) return;
  await supabase.rpc("save_watch_progress", {
    p_device: deviceId,
    p_movie: movieId,
    p_position_seconds: currentTime,
    p_duration_seconds: duration,
  });
}

export async function clearWatchProgressInDb(deviceId: string, movieId: string) {
  if (!deviceId) return;
  await supabase.rpc("clear_watch_progress", { p_device: deviceId, p_movie: movieId });
}

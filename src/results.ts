// Personal best (localStorage) and the share text.
import type { Stats } from "./types.ts";

export const STORAGE_KEY = "treadmill.v1";
export const SITE = "treadmill.cosmo030.com";

export interface Saved {
  best: number;
}

/** Reads the saved JSON defensively: anything unexpected means "no best yet". */
export function parseSaved(raw: string | null): Saved {
  if (!raw) return { best: 0 };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { best: 0 };
  }
  if (typeof data === "object" && data !== null && "best" in data) {
    const best = data.best;
    if (typeof best === "number" && Number.isFinite(best) && best > 0) return { best: Math.round(best) };
  }
  return { best: 0 };
}

export interface BestStore {
  read(): number;
  /** Saves `wpm` if it beats the stored best. Returns true when it did. */
  offer(wpm: number): boolean;
}

/** `storage` is null when localStorage is blocked: the best then lasts for the visit. */
export function createBestStore(storage: Pick<Storage, "getItem" | "setItem"> | null): BestStore {
  let best = 0;
  try {
    best = parseSaved(storage?.getItem(STORAGE_KEY) ?? null).best;
  } catch {
    best = 0;
  }
  return {
    read: () => best,
    offer(wpm) {
      if (wpm <= best) return false;
      best = wpm;
      try {
        storage?.setItem(STORAGE_KEY, JSON.stringify({ best } satisfies Saved));
      } catch {
        // Storage full or blocked: keep it in memory.
      }
      return true;
    },
  };
}

export function shareText(stats: Pick<Stats, "wpm" | "accuracy" | "stumbles">): string {
  return `🏃 ${stats.wpm} WPM · ${stats.accuracy}% accuracy · tripped ${stats.stumbles}× — ${SITE}`;
}

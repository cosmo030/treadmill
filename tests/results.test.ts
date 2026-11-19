import { describe, expect, it } from "vitest";
import { createBestStore, parseSaved, shareText, STORAGE_KEY } from "../src/results.ts";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

describe("best WPM", () => {
  it("parses saved data defensively", () => {
    expect(parseSaved(null)).toEqual({ best: 0 });
    expect(parseSaved("nope")).toEqual({ best: 0 });
    expect(parseSaved('{"best":"fast"}')).toEqual({ best: 0 });
    expect(parseSaved('{"best":-4}')).toEqual({ best: 0 });
    expect(parseSaved('{"best":71}')).toEqual({ best: 71 });
  });

  it("only saves a new best", () => {
    const storage = memoryStorage({ [STORAGE_KEY]: '{"best":60}' });
    const store = createBestStore(storage);
    expect(store.read()).toBe(60);
    expect(store.offer(55)).toBe(false);
    expect(store.offer(60)).toBe(false);
    expect(store.offer(61)).toBe(true);
    expect(store.read()).toBe(61);
    expect(storage.data.get(STORAGE_KEY)).toBe('{"best":61}');
  });

  it("works without storage", () => {
    const store = createBestStore(null);
    expect(store.offer(20)).toBe(true);
    expect(store.read()).toBe(20);
  });
});

describe("share text", () => {
  it("matches the format", () => {
    expect(shareText({ wpm: 62, accuracy: 97, stumbles: 3 })).toBe(
      "🏃 62 WPM · 97% accuracy · tripped 3× — treadmill.cosmo030.com",
    );
  });
});

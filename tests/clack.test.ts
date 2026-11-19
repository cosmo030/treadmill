import { describe, expect, it } from "vitest";
import keysWav from "../public/sounds/keys.wav?inline";
import { clackFor, pickVariant, planPress, VOICINGS } from "../src/clack.ts";
import { KEY_SPRITE, type Slice } from "../src/keySprite.ts";
import { soundPreference } from "../src/sound.ts";
import { seeded } from "./helpers.ts";

/** Reads the 16-bit mono WAV the slicing script writes (inlined by Vite as a data URL). */
function readWav(dataUrl: string): { sampleRate: number; channels: number; samples: Float32Array } {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const ascii = (from: number, to: number): string => String.fromCharCode(...bytes.subarray(from, to));
  expect(ascii(0, 4)).toBe("RIFF");
  expect(ascii(8, 12)).toBe("WAVE");
  let off = 12;
  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  while (off < bytes.length) {
    const id = ascii(off, off + 4);
    const size = view.getUint32(off + 4, true);
    if (id === "fmt ") {
      channels = view.getUint16(off + 10, true);
      sampleRate = view.getUint32(off + 12, true);
      bits = view.getUint16(off + 22, true);
    }
    if (id === "data") {
      expect(bits).toBe(16);
      const n = size / 2;
      const samples = new Float32Array(n);
      for (let i = 0; i < n; i++) samples[i] = view.getInt16(off + 8 + i * 2, true) / 32768;
      return { sampleRate, channels, samples };
    }
    off += 8 + size + (size % 2);
  }
  throw new Error("no data chunk");
}

const wav = readWav(keysWav);
const all: Slice[] = [...KEY_SPRITE.key, ...KEY_SPRITE.space];

describe("the recorded keystrokes", () => {
  it("is a mono WAV that matches the generated slice list", () => {
    expect(wav.channels).toBe(1);
    expect(wav.sampleRate).toBe(44_100);
    expect(wav.samples.length / wav.sampleRate).toBeCloseTo(KEY_SPRITE.length, 2);
    expect(KEY_SPRITE.key.length).toBeGreaterThanOrEqual(6);
    expect(KEY_SPRITE.space.length).toBeGreaterThanOrEqual(3);
  });

  it("has short slices inside the file that don't overlap", () => {
    const sorted = [...all].sort((a, b) => a[0] - b[0]);
    let prevEnd = 0;
    for (const [start, dur] of sorted) {
      expect(dur).toBeGreaterThan(0.07);
      expect(dur).toBeLessThan(0.2);
      expect(start).toBeGreaterThanOrEqual(prevEnd);
      prevEnd = start + dur;
    }
    expect(prevEnd).toBeLessThanOrEqual(KEY_SPRITE.length);
  });

  it("starts every slice right on its keystroke (no lag) and fades it out", () => {
    const SR = wav.sampleRate;
    for (const [start, dur] of all) {
      const s = Math.round(start * SR);
      const e = Math.round((start + dur) * SR);
      let peakAt = s;
      let peak = 0;
      for (let i = s; i < e; i++) {
        const v = Math.abs(wav.samples[i] ?? 0);
        if (v > peak) {
          peak = v;
          peakAt = i;
        }
      }
      expect(peak).toBeGreaterThan(0.2);
      expect(peak).toBeLessThan(0.97); // levelled, never clipped
      expect((peakAt - s) / SR).toBeLessThan(0.01); // the hit is the first thing you hear
      expect(Math.abs(wav.samples[e - 1] ?? 1)).toBeLessThan(0.01); // faded, no click at the end
    }
  });
});

describe("which sound plays", () => {
  it("maps keys to sounds, clacking even when the game ignores the key", () => {
    expect(clackFor("char", "correct")).toBe("key");
    expect(clackFor("char", "wrong")).toBe("wrong");
    expect(clackFor("space", "advanced")).toBe("space");
    expect(clackFor("space", "ignored")).toBe("space");
    expect(clackFor("backspace", "deleted")).toBe("back");
    expect(clackFor("clearWord", "ignored")).toBe("back");
  });

  it("never plays the same keystroke twice in a row", () => {
    const rng = seeded(3);
    let last = -1;
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = pickVariant(8, last, rng);
      expect(v).not.toBe(last);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(8);
      seen.add(v);
      last = v;
    }
    expect(seen.size).toBe(8);
    expect(pickVariant(1, 0, rng)).toBe(0);
  });

  it("plays the space bar from its own slices, and a typo lower and muffled", () => {
    const rng = seeded(5);
    for (let i = 0; i < 50; i++) {
      const space = planPress("space", KEY_SPRITE, -1, rng);
      expect(KEY_SPRITE.space).toContain(space?.slice);
      const wrong = planPress("wrong", KEY_SPRITE, -1, rng);
      const key = planPress("key", KEY_SPRITE, -1, rng);
      const back = planPress("back", KEY_SPRITE, -1, rng);
      if (!wrong || !key || !back) throw new Error("no press");
      expect(KEY_SPRITE.key).toContain(wrong.slice);
      expect(wrong.rate).toBeLessThan(key.rate);
      expect(wrong.lowpass).toBeGreaterThan(0);
      expect(key.lowpass).toBe(0);
      expect(back.rate).toBeGreaterThan(key.rate);
    }
    expect(VOICINGS.wrong.lowpass).toBeLessThan(3000);
  });

  it("returns nothing when there are no slices", () => {
    expect(planPress("key", { key: [], space: [] }, -1, seeded(1))).toBeNull();
  });
});

describe("sound preference", () => {
  it("is on with a keyboard and off on touch screens by default, and remembers a choice", () => {
    expect(soundPreference(null, false)).toBe(true);
    expect(soundPreference(null, true)).toBe(false);
    expect(soundPreference("on", true)).toBe(true);
    expect(soundPreference("off", false)).toBe(false);
    expect(soundPreference("garbage", false)).toBe(true);
  });
});

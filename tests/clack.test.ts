import { describe, expect, it } from "vitest";
import { CLACK_PEAK, clackFor, clackParams, pickVariant, synthClack, type ClackKind } from "../src/clack.ts";
import { seeded } from "./helpers.ts";

const SR = 48_000;
const KINDS: ClackKind[] = ["key", "space", "back", "wrong"];

/** Energy above `hz`, as a share of the total (rough brightness measure via first differences). */
function brightness(x: Float32Array): number {
  let diff = 0;
  let all = 0;
  for (let i = 1; i < x.length; i++) {
    const a = x[i] ?? 0;
    const b = x[i - 1] ?? 0;
    diff += (a - b) ** 2;
    all += a * a;
  }
  return diff / (all || 1);
}

/** Time (s) until the signal stays below `level`. */
function decayTime(x: Float32Array, level: number): number {
  let last = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(x[i] ?? 0) > level) last = i;
  return last / SR;
}

describe("clack synthesis", () => {
  it("renders a short, normalised clip that starts at once and ends in silence", () => {
    for (const kind of KINDS) {
      const x = synthClack(clackParams(kind, seeded(1)), SR, seeded(2));
      expect(x.length / SR).toBeLessThan(0.2);
      let peak = 0;
      for (const v of x) {
        expect(Number.isFinite(v)).toBe(true);
        peak = Math.max(peak, Math.abs(v));
      }
      expect(peak).toBeCloseTo(CLACK_PEAK, 5);
      // The attack is within the first couple of milliseconds: no audible lag.
      let first = 0;
      while (Math.abs(x[first] ?? 0) < 0.1) first++;
      expect(first / SR).toBeLessThan(0.002);
      expect(Math.abs(x[x.length - 1] ?? 1)).toBeLessThan(0.001);
    }
  });

  it("varies from one variant to the next", () => {
    const rng = seeded(4);
    const a = synthClack(clackParams("key", rng), SR, rng);
    const b = synthClack(clackParams("key", rng), SR, rng);
    let diff = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) diff += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
    expect(diff).toBeGreaterThan(10);
  });

  it("has an upstroke click after the downstroke", () => {
    const p = clackParams("key", seeded(7));
    const x = synthClack(p, SR, seeded(8));
    const at = Math.round(p.releaseAt * SR);
    let before = 0;
    let after = 0;
    for (let i = at - 120; i < at; i++) before = Math.max(before, Math.abs(x[i] ?? 0));
    for (let i = at; i < at + 120; i++) after = Math.max(after, Math.abs(x[i] ?? 0));
    expect(after).toBeGreaterThan(before * 1.5);
  });

  it("makes a typo duller than a correct letter, and the space bar ring longer", () => {
    const avg = (kind: ClackKind, f: (x: Float32Array) => number): number => {
      let s = 0;
      for (let i = 0; i < 8; i++) s += f(synthClack(clackParams(kind, seeded(10 + i)), SR, seeded(20 + i)));
      return s / 8;
    };
    expect(avg("wrong", brightness)).toBeLessThan(avg("key", brightness) * 0.6);
    expect(avg("space", (x) => decayTime(x, 0.05))).toBeGreaterThan(avg("key", (x) => decayTime(x, 0.05)));
  });
});

describe("picking sounds", () => {
  it("never plays the same variant twice in a row", () => {
    const rng = seeded(3);
    let last = -1;
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = pickVariant(6, last, rng);
      expect(v).not.toBe(last);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      seen.add(v);
      last = v;
    }
    expect(seen.size).toBe(6);
    expect(pickVariant(1, 0, rng)).toBe(0);
  });

  it("maps keys to sounds, clacking even when the game ignores the key", () => {
    expect(clackFor("char", "correct")).toBe("key");
    expect(clackFor("char", "wrong")).toBe("wrong");
    expect(clackFor("space", "advanced")).toBe("space");
    expect(clackFor("space", "ignored")).toBe("space");
    expect(clackFor("backspace", "deleted")).toBe("back");
    expect(clackFor("clearWord", "ignored")).toBe("back");
  });
});

describe("sound preference", async () => {
  const { soundPreference } = await import("../src/sound.ts");
  it("is on with a keyboard and off on touch screens by default, and remembers a choice", () => {
    expect(soundPreference(null, false)).toBe(true);
    expect(soundPreference(null, true)).toBe(false);
    expect(soundPreference("on", true)).toBe(true);
    expect(soundPreference("off", false)).toBe(false);
    expect(soundPreference("garbage", false)).toBe(true);
  });
});

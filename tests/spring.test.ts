import { describe, expect, it } from "vitest";
import { atRest, isResting, stepSpring, type Spring } from "../src/spring.ts";

function simulate(start: Spring, ms: number, frameMs = 16): number[] {
  const xs: number[] = [];
  let s = start;
  for (let t = 0; t < ms; t += frameMs) {
    s = stepSpring(s, frameMs / 1000);
    xs.push(s.x);
  }
  return xs;
}

describe("overshoot spring", () => {
  it("kicks out, overshoots past rest and settles within ~400 ms", () => {
    const xs = simulate({ x: 0, v: 37 }, 1000);
    const peak = Math.max(...xs);
    expect(peak).toBeGreaterThan(0.7);
    expect(peak).toBeLessThan(1.3);
    expect(Math.min(...xs)).toBeLessThan(-0.1); // the overshoot
    const after400 = xs.slice(Math.ceil(400 / 16));
    for (const x of after400) expect(Math.abs(x)).toBeLessThan(0.15 * peak);
  });

  it("comes to rest exactly", () => {
    let s: Spring = { x: 1, v: 0 };
    for (let i = 0; i < 200; i++) s = stepSpring(s, 0.016);
    expect(isResting(s)).toBe(true);
    expect(stepSpring(atRest(), 0.1)).toEqual(atRest());
  });

  it("doesn't depend much on frame rate", () => {
    const a = simulate({ x: 0, v: 37 }, 300, 10).at(-1) ?? NaN;
    const b = simulate({ x: 0, v: 37 }, 300, 50).at(-1) ?? NaN;
    expect(Math.abs(a - b)).toBeLessThan(0.05);
  });
});

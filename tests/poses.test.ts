import { describe, expect, it } from "vitest";
import { cyclePose, FRAMES, gaitFor, motionFor, PANT, skeleton, STAND, VICTORY } from "../src/poses.ts";

describe("gait from WPM", () => {
  it("follows the thresholds", () => {
    expect(gaitFor(0)).toBe("stand");
    expect(gaitFor(15)).toBe("walk");
    expect(gaitFor(29.9)).toBe("walk");
    expect(gaitFor(30)).toBe("jog");
    expect(gaitFor(60)).toBe("run");
    expect(gaitFor(90)).toBe("sprint");
  });

  it("changes gradually: every motion value grows smoothly with speed", () => {
    let prev = motionFor(0);
    for (let v = 0.5; v <= 140; v += 0.5) {
      const m = motionFor(v);
      for (const key of ["stride", "run", "sprint", "lean", "cadence", "beltSpeed"] as const) {
        expect(m[key]).toBeGreaterThanOrEqual(prev[key]);
        // No jumps between neighbouring speeds (cadence starts from 0 at a standstill).
        if (key !== "cadence" || v > 1) expect(m[key] - prev[key]).toBeLessThan(key === "beltSpeed" ? 12 : 1.5);
      }
      prev = m;
    }
  });

  it("stands still at 0 WPM", () => {
    const m = motionFor(0);
    expect(m.cadence).toBe(0);
    expect(m.beltSpeed).toBe(0);
    expect(cyclePose(3, m)).toEqual(STAND);
  });
});

describe("skeleton", () => {
  it("always has a foot on the belt", () => {
    for (const wpm of [5, 25, 45, 75, 110]) {
      for (let f = 0; f < FRAMES; f++) {
        const pose = { ...cyclePose(f, motionFor(wpm)), lift: 0 };
        const sk = skeleton(pose, 200, 186);
        expect(Math.max(sk.footNear[1], sk.footFar[1])).toBeCloseTo(186, 5);
      }
    }
    for (const pose of [STAND, PANT, VICTORY]) {
      const sk = skeleton(pose, 200, 186);
      expect(Math.max(sk.footNear[1], sk.footFar[1])).toBeCloseTo(186, 5);
    }
  });

  it("keeps hangman's proportions when standing", () => {
    const sk = skeleton(STAND, 165, 214);
    // Hangman: head centre 82, neck 102, shoulder 118, hip 170, feet 214.
    expect(sk.neck[1] - sk.head[1]).toBeCloseTo(20, 5);
    expect(sk.shoulder[1] - sk.neck[1]).toBeCloseTo(16, 5);
    expect(sk.hip[1] - sk.shoulder[1]).toBeCloseTo(52, 5);
    expect(214 - sk.hip[1]).toBeGreaterThan(42);
    expect(214 - sk.hip[1]).toBeLessThan(48);
  });

  it("victory hands end up clear of the head", () => {
    const sk = skeleton(VICTORY, 200, 186);
    for (const hand of [sk.handNear, sk.handFar]) {
      expect(Math.hypot(hand[0] - sk.head[0], hand[1] - sk.head[1])).toBeGreaterThan(22);
    }
  });
});

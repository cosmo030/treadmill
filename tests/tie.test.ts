import { describe, expect, it } from "vitest";
import {
  createTie,
  kickTie,
  STILL_AIR,
  staticTie,
  stepTie,
  TIE_POINTS,
  TIE_SEGMENT,
  tieForces,
  type Tie,
} from "../src/tie.ts";
import type { Point } from "../src/types.ts";

const ANCHOR: Point = [100, 50];

function run(tie: Tie, seconds: number, forces = STILL_AIR, anchor = ANCHOR): void {
  for (let t = 0; t < seconds; t += 1 / 60) stepTie(tie, anchor, forces, 1 / 60);
}

const tip = (tie: Tie): [number, number] => {
  const p = tie.pts[TIE_POINTS - 1];
  if (!p) throw new Error("no tip");
  return p;
};

function segmentsOk(tie: Tie): void {
  for (let i = 1; i < tie.pts.length; i++) {
    const a = tie.pts[i - 1];
    const b = tie.pts[i];
    if (!a || !b) throw new Error("missing point");
    expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(TIE_SEGMENT, 0);
  }
}

describe("tie physics", () => {
  it("is a chain of 3–4 points pinned at the knot", () => {
    const tie = createTie(ANCHOR);
    expect(TIE_POINTS).toBeGreaterThanOrEqual(3);
    expect(TIE_POINTS).toBeLessThanOrEqual(4);
    run(tie, 1, tieForces("move", 80, 0, 0));
    expect(tie.pts[0]).toEqual([ANCHOR[0], ANCHOR[1]]);
  });

  it("hangs straight down in still air", () => {
    const tie = createTie(ANCHOR);
    kickTie(tie, 400, -400);
    run(tie, 3);
    expect(tip(tie)[0]).toBeCloseTo(ANCHOR[0], 0);
    expect(tip(tie)[1]).toBeCloseTo(ANCHOR[1] + TIE_SEGMENT * (TIE_POINTS - 1), 0);
    segmentsOk(tie);
  });

  it("follows the knot when the body moves", () => {
    const tie = createTie(ANCHOR);
    run(tie, 2, STILL_AIR, [140, 70]);
    expect(tip(tie)[0]).toBeCloseTo(140, 0);
    expect(tip(tie)[1]).toBeGreaterThan(70);
  });

  it("trails further back the faster he runs", () => {
    const angleAt = (wpm: number): number => {
      const tie = createTie(ANCHOR);
      run(tie, 2, tieForces("move", wpm, 0, 0));
      let sum = 0;
      for (let i = 0; i < 60; i++) {
        stepTie(tie, ANCHOR, tieForces("move", wpm, 0, 0), 1 / 60);
        sum += Math.atan2(ANCHOR[0] - tip(tie)[0], tip(tie)[1] - ANCHOR[1]);
      }
      return (sum / 60) * (180 / Math.PI); // degrees back from hanging
    };
    const walk = angleAt(20);
    const jog = angleAt(45);
    const run75 = angleAt(75);
    expect(walk).toBeGreaterThan(10);
    expect(jog).toBeGreaterThan(walk);
    expect(run75).toBeGreaterThan(jog);
  });

  it("flips up and streams behind when sprinting", () => {
    const tie = createTie(ANCHOR);
    run(tie, 2, tieForces("move", 110, 1, 0));
    expect(tip(tie)[0]).toBeLessThan(ANCHOR[0] - 15); // behind him
    expect(tip(tie)[1]).toBeLessThan(ANCHOR[1]); // above the knot: over the shoulder
    segmentsOk(tie);
  });

  it("flaps faster with speed", () => {
    expect(tieForces("move", 90, 0, 0).flapHz).toBeGreaterThan(tieForces("move", 30, 0, 0).flapHz);
    // ...and actually moves around while running.
    const tie = createTie(ANCHOR);
    run(tie, 1, tieForces("move", 60, 0, 0));
    const ys: number[] = [];
    for (let i = 0; i < 60; i++) {
      stepTie(tie, ANCHOR, tieForces("move", 60, 0, 0), 1 / 60);
      ys.push(tip(tie)[1]);
    }
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(2);
  });

  it("whips forward and up on a stumble, then falls back", () => {
    const tie = createTie(ANCHOR);
    kickTie(tie, 380, -760);
    run(tie, 0.12);
    expect(tip(tie)[0]).toBeGreaterThan(ANCHOR[0] + 8);
    expect(tip(tie)[1]).toBeLessThan(ANCHOR[1] + TIE_SEGMENT * (TIE_POINTS - 1) - 8);
    run(tie, 3);
    expect(tip(tie)[0]).toBeCloseTo(ANCHOR[0], 0);
  });

  it("stays finite with a huge time step", () => {
    const tie = createTie(ANCHOR);
    stepTie(tie, ANCHOR, tieForces("move", 200, 1, 0), 5);
    for (const p of tie.pts) {
      expect(Number.isFinite(p[0])).toBe(true);
      expect(Number.isFinite(p[1])).toBe(true);
    }
  });

  it("has a still version for reduced motion", () => {
    const pts = staticTie(ANCHOR, 0);
    expect(pts).toHaveLength(TIE_POINTS);
    expect(pts.at(-1)).toEqual([ANCHOR[0], ANCHOR[1] + TIE_SEGMENT * (TIE_POINTS - 1)]);
    const back = staticTie(ANCHOR, -45).at(-1);
    expect(back?.[0]).toBeLessThan(ANCHOR[0]);
  });
});

describe("pinning", () => {
  it("keeps the knot on the collar when the body jumps between drawn frames", async () => {
    const { pinTie } = await import("../src/tie.ts");
    const tie = createTie(ANCHOR);
    run(tie, 1, tieForces("move", 60, 0, 0));
    const jumped: Point = [ANCHOR[0] + 30, ANCHOR[1] - 12];
    pinTie(tie, jumped);
    expect(tie.pts[0]).toEqual([jumped[0], jumped[1]]);
    for (let i = 1; i < tie.pts.length; i++) {
      const a = tie.pts[i - 1];
      const b = tie.pts[i];
      if (!a || !b) throw new Error("missing point");
      expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeLessThan(TIE_SEGMENT + 1);
    }
  });
});

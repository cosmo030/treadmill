// The mascot's tie: a short chain of points simulated with verlet integration
// (gravity, drag, wind and a flutter force), pinned at the collar. runner.ts
// decides the forces from what the figure is doing and draws the tie through
// these points; nothing here is animated by hand.
import type { Point } from "./types.ts";

/** Points in the chain, including the pinned knot. */
export const TIE_POINTS = 4;
/** Distance between neighbouring points, logical px. */
export const TIE_SEGMENT = 10;

const STEP = 1 / 120; // fixed physics step, seconds
const GRAVITY = 900; // px/s²
const ITERATIONS = 4; // constraint passes per step

type Vec = [number, number];

export interface Tie {
  /** Current positions. `pts[0]` is the knot, pinned to the collar. */
  readonly pts: Vec[];
  /** Positions one step ago; the difference is the velocity. */
  readonly prev: Vec[];
  /** Simulated time, drives the flutter. */
  time: number;
  /** Leftover time that didn't fill a whole step yet. */
  carry: number;
}

/** What acts on the tie right now. */
export interface TieForces {
  /** Steady wind, px/s². Negative x blows it back (the runner faces +x). */
  readonly windX: number;
  readonly windY: number;
  /** Strength of the flutter, px/s². 0 = no flapping. */
  readonly flap: number;
  /** Flutter frequency, Hz. */
  readonly flapHz: number;
  /** Velocity damping per second. Higher = limper. */
  readonly drag: number;
}

export const STILL_AIR: TieForces = { windX: 0, windY: 0, flap: 0, flapHz: 0, drag: 4 };

/** A tie hanging straight down from `anchor`, at rest. */
export function createTie(anchor: Point): Tie {
  const pts: Vec[] = [];
  for (let i = 0; i < TIE_POINTS; i++) pts.push([anchor[0], anchor[1] + i * TIE_SEGMENT]);
  return { pts, prev: pts.map((p): Vec => [p[0], p[1]]), time: 0, carry: 0 };
}

/** Advances the simulation by `dt` seconds with the knot pinned at `anchor`. */
export function stepTie(tie: Tie, anchor: Point, forces: TieForces, dt: number): void {
  tie.carry += Math.min(Math.max(dt, 0), 0.1); // a long pause can't explode it
  while (tie.carry >= STEP) {
    tie.carry -= STEP;
    tie.time += STEP;
    integrate(tie, anchor, forces);
  }
}

function integrate(tie: Tie, anchor: Point, f: TieForces): void {
  const { pts, prev } = tie;
  const keep = Math.max(0, 1 - f.drag * STEP);
  const w = 2 * Math.PI * f.flapHz * tie.time;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    const q = prev[i];
    if (!p || !q) continue;
    // Flutter: a wave that travels down the tie, stronger towards the tip.
    const reach = i / (pts.length - 1);
    const ax = f.windX + f.flap * 0.45 * reach * Math.sin(w * 1.7 + i * 0.7);
    const ay = GRAVITY + f.windY + f.flap * reach * Math.sin(w + i * 1.1);
    const vx = (p[0] - q[0]) * keep;
    const vy = (p[1] - q[1]) * keep;
    q[0] = p[0];
    q[1] = p[1];
    p[0] += vx + ax * STEP * STEP;
    p[1] += vy + ay * STEP * STEP;
  }
  solve(tie, anchor);
}

/** Pins the knot at `anchor` and puts every segment back to its length. */
function solve(tie: Tie, anchor: Point, iterations = ITERATIONS): void {
  const { pts } = tie;
  const knot = pts[0];
  if (knot) {
    knot[0] = anchor[0];
    knot[1] = anchor[1];
  }
  for (let n = 0; n < iterations; n++) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (!a || !b) continue;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const d = Math.hypot(dx, dy) || 1e-6;
      const diff = (d - TIE_SEGMENT) / d;
      if (i === 1) {
        // The knot doesn't move: the free point takes the whole correction.
        b[0] -= dx * diff;
        b[1] -= dy * diff;
      } else {
        a[0] += dx * diff * 0.5;
        a[1] += dy * diff * 0.5;
        b[0] -= dx * diff * 0.5;
        b[1] -= dy * diff * 0.5;
      }
    }
  }
}

/**
 * Re-pins the knot right away, without advancing time. Call it whenever the
 * figure's pose jumps (every drawn frame), so the tie never comes off his neck.
 * `carry` is the share of the jump the tie feels as a push: the pose jumps at
 * the drawing rate (10–20 times a second), so treating the whole jump as one
 * physics step's worth of velocity would fling the tie about. Same as hangman.
 */
export function pinTie(tie: Tie, anchor: Point, carry = 0.15): void {
  const before = tie.pts.map((p): Vec => [p[0], p[1]]);
  solve(tie, anchor, ITERATIONS * 3);
  tie.pts.forEach((p, i) => {
    const b = before[i];
    const q = tie.prev[i];
    if (!b || !q) return;
    q[0] += (p[0] - b[0]) * (1 - carry);
    q[1] += (p[1] - b[1]) * (1 - carry);
  });
}

/** Adds velocity (px/s), more towards the tip: a flick from a stumble or a jump. */
export function kickTie(tie: Tie, vx: number, vy: number): void {
  const last = tie.pts.length - 1;
  for (let i = 1; i <= last; i++) {
    const q = tie.prev[i];
    if (!q) continue;
    const reach = i / last;
    q[0] -= vx * reach * STEP;
    q[1] -= vy * reach * STEP;
  }
}

/** Moves the whole tie with the figure (e.g. after a reset), keeping its shape and stopping it. */
export function settleTie(tie: Tie, anchor: Point): void {
  const fresh = createTie(anchor);
  tie.pts.forEach((p, i) => {
    const f = fresh.pts[i];
    const q = tie.prev[i];
    if (!f || !q) return;
    p[0] = f[0];
    p[1] = f[1];
    q[0] = f[0];
    q[1] = f[1];
  });
}

/**
 * A still tie for reduced motion: a straight line from the knot at `angle`
 * degrees (0 = straight down, positive = forward), no physics, no flapping.
 */
export function staticTie(anchor: Point, angle: number): Point[] {
  const r = (angle * Math.PI) / 180;
  const d: Point = [Math.sin(r), Math.cos(r)];
  return Array.from({ length: TIE_POINTS }, (_, i): Point => [anchor[0] + d[0] * TIE_SEGMENT * i, anchor[1] + d[1] * TIE_SEGMENT * i]);
}

// ---------------------------------------------------------------------------
// From what the runner is doing to forces on the tie
// ---------------------------------------------------------------------------

export type TieMood = "stand" | "move" | "limp" | "victory";

/**
 * Forces for a mood and speed. Running pushes it back with a "wind" that grows
 * with WPM and flaps faster; a sprint (`sprint` 0–1) tilts that wind upwards
 * so the tie flips over the shoulder and streams behind.
 */
export function tieForces(mood: TieMood, wpm: number, sprint: number, time: number): TieForces {
  switch (mood) {
    case "stand":
      // Hangs down, swaying a little.
      return { windX: 70 * Math.sin(time * 2 * Math.PI * 0.35), windY: 0, flap: 25, flapHz: 0.8, drag: 3 };
    case "limp":
      return { ...STILL_AIR, drag: 7 };
    case "victory":
      return { ...STILL_AIR, drag: 2.5 };
    case "move": {
      const v = Math.max(0, wpm);
      const strength = Math.min(3200, 22 * v);
      const lift = (sprint * 42 * Math.PI) / 180;
      return {
        windX: -strength * Math.cos(lift),
        windY: -strength * Math.sin(lift),
        flap: 60 + strength * 0.38,
        flapHz: 2.5 + v / 12,
        drag: 3.5,
      };
    }
  }
}

/** Steady angle of the tie for reduced motion: hangs, tilts with the pose and the speed. */
export function staticTieAngle(mood: TieMood, wpm: number, lean: number): number {
  if (mood === "victory") return 0;
  // Halfway between hanging straight down and lying along the leaning torso.
  const pose = -lean * 0.5;
  if (mood !== "move") return pose;
  return pose - Math.min(70, wpm * 0.6);
}

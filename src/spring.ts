// Overshoot spring, ported from hangman's figure.js (the sideways flinch).
// A damped spring that kicks out, overshoots past rest and settles in about
// 300–400 ms. Stepped at a fixed 240 Hz so it behaves the same at any frame rate.

export interface Spring {
  /** Displacement from rest (0). */
  x: number;
  /** Velocity, units per second. */
  v: number;
}

export interface SpringConfig {
  /** Stiffness. */
  readonly k: number;
  /** Damping. Lower = more overshoot. */
  readonly c: number;
}

/** Hangman's values: snappy with one clear overshoot. */
export const OVERSHOOT: SpringConfig = { k: 520, c: 17 };

const STEP = 1 / 240;

export const atRest = (): Spring => ({ x: 0, v: 0 });

/** Advances the spring by `dt` seconds towards 0. Snaps to rest once it's tiny. */
export function stepSpring(s: Spring, dt: number, cfg: SpringConfig = OVERSHOOT): Spring {
  let { x, v } = s;
  for (let t = 0; t < dt; t += STEP) {
    const a = -cfg.k * x - cfg.c * v;
    v += a * STEP;
    x += v * STEP;
  }
  if (Math.abs(x) < 0.002 && Math.abs(v) < 0.05) return atRest();
  return { x, v };
}

export const isResting = (s: Spring): boolean => s.x === 0 && s.v === 0;

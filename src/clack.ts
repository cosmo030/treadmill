// The keyboard clack, synthesised sample by sample. Pure functions, no Web
// Audio here, so it's testable and the same buffers can be rendered anywhere.
//
// A mechanical key sounds like four things on top of each other:
//   1. a sharp contact click as the keycap starts moving,
//   2. the plastic "body" of the key (band-passed noise),
//   3. a low "thock" when it bottoms out (a short falling sine), plus a small
//      ping from the case,
//   4. a softer click as it springs back up a few tens of milliseconds later.
// Each kind of key gets its own ranges, and every variant rolls new values in
// those ranges, so no two clacks are the same (the audio version of line boil).

import type { KeyInput, KeyOutcome } from "./types.ts";

export type ClackKind = "key" | "space" | "back" | "wrong";

export type Rng = () => number;

export interface ClackParams {
  /** Total length, seconds. */
  readonly length: number;
  /** Contact click: loudness and high-pass cutoff. */
  readonly click: number;
  readonly clickHz: number;
  /** Plastic body: band-pass centre, Q, decay (s), loudness. */
  readonly bodyHz: number;
  readonly bodyQ: number;
  readonly bodyDecay: number;
  readonly body: number;
  /** Bottom-out thock: end pitch, decay (s), loudness. */
  readonly thockHz: number;
  readonly thockDecay: number;
  readonly thock: number;
  /** Case ping: pitch and loudness. */
  readonly pingHz: number;
  readonly ping: number;
  /** Upstroke: delay (s) and loudness relative to the downstroke. */
  readonly releaseAt: number;
  readonly release: number;
  /** Stabiliser rattle (space bar): a second down click this many seconds later, 0 = none. */
  readonly rattleAt: number;
  /** Overall low-pass, Hz. Lower = duller. */
  readonly toneHz: number;
}

const between = (rng: Rng, lo: number, hi: number): number => lo + rng() * (hi - lo);

/** Random parameters for one variant of a kind of key. */
export function clackParams(kind: ClackKind, rng: Rng): ClackParams {
  const r = (lo: number, hi: number): number => between(rng, lo, hi);
  switch (kind) {
    case "key":
      return {
        length: 0.1, click: r(0.8, 1), clickHz: r(3500, 5000),
        bodyHz: r(1800, 2600), bodyQ: r(1.1, 1.6), bodyDecay: r(0.012, 0.018), body: r(0.8, 0.95),
        thockHz: r(190, 240), thockDecay: r(0.011, 0.016), thock: r(0.35, 0.45),
        pingHz: r(720, 950), ping: r(0.03, 0.05),
        releaseAt: r(0.038, 0.058), release: r(0.5, 0.62), rattleAt: 0, toneHz: r(8500, 10500),
      };
    case "space":
      // Bigger and deeper, with the stabiliser rattling a moment later.
      return {
        length: 0.14, click: r(0.7, 0.85), clickHz: r(3000, 4200),
        bodyHz: r(1050, 1400), bodyQ: r(1.0, 1.4), bodyDecay: r(0.018, 0.026), body: r(0.85, 1),
        thockHz: r(118, 145), thockDecay: r(0.02, 0.028), thock: r(0.5, 0.6),
        pingHz: r(480, 620), ping: r(0.04, 0.06),
        releaseAt: r(0.06, 0.08), release: r(0.45, 0.55), rattleAt: r(0.003, 0.006), toneHz: r(7000, 8500),
      };
    case "back":
      // A little lighter and higher than a letter.
      return {
        length: 0.09, click: r(0.75, 0.9), clickHz: r(4000, 5500),
        bodyHz: r(2300, 3000), bodyQ: r(1.2, 1.7), bodyDecay: r(0.01, 0.014), body: r(0.7, 0.85),
        thockHz: r(240, 280), thockDecay: r(0.009, 0.013), thock: r(0.28, 0.36),
        pingHz: r(900, 1100), ping: r(0.02, 0.04),
        releaseAt: r(0.034, 0.048), release: r(0.42, 0.52), rattleAt: 0, toneHz: r(9000, 11000),
      };
    case "wrong":
      // The same key, but duller and lower: you hear a typo without looking.
      return {
        length: 0.1, click: r(0.45, 0.55), clickHz: r(2500, 3200),
        bodyHz: r(1200, 1600), bodyQ: r(0.9, 1.2), bodyDecay: r(0.014, 0.02), body: r(0.8, 0.95),
        thockHz: r(140, 165), thockDecay: r(0.014, 0.02), thock: r(0.45, 0.55),
        pingHz: r(520, 640), ping: r(0.02, 0.04),
        releaseAt: r(0.04, 0.06), release: r(0.36, 0.46), rattleAt: 0, toneHz: r(2600, 3400),
      };
  }
}

// ---------------------------------------------------------------------------
// A tiny biquad (RBJ cookbook) for the noise filters.
// ---------------------------------------------------------------------------

type FilterType = "lowpass" | "highpass" | "bandpass";

class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(type: FilterType, hz: number, q: number, sampleRate: number) {
    const w = (2 * Math.PI * Math.min(hz, sampleRate * 0.45)) / sampleRate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    let b0: number;
    let b1: number;
    let b2: number;
    if (type === "lowpass") {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
    } else if (type === "highpass") {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
    } else {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    }
    const a0 = 1 + alpha;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  next(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Peak level after normalising, leaves headroom for overlapping clacks. */
export const CLACK_PEAK = 0.8;

/** Renders one clack to mono samples in [-1, 1]. */
export function synthClack(p: ClackParams, sampleRate: number, rng: Rng): Float32Array<ArrayBuffer> {
  const n = Math.max(1, Math.round(p.length * sampleRate));
  const out = new Float32Array(n);
  const clickHp = new Biquad("highpass", p.clickHz, 0.7, sampleRate);
  const bodyBp = new Biquad("bandpass", p.bodyHz, p.bodyQ, sampleRate);
  const relHp = new Biquad("highpass", p.clickHz * 1.15, 0.7, sampleRate);
  const relBp = new Biquad("bandpass", p.bodyHz * 1.3, p.bodyQ, sampleRate);
  const tone = new Biquad("lowpass", p.toneHz, 0.7, sampleRate);
  let phase = 0;
  let pingPhase = 0;

  // Exponential decays, stepped by multiplying (far cheaper than Math.exp per sample).
  const decay = (seconds: number): number => Math.exp(-1 / (seconds * sampleRate));
  const kClick = decay(0.0018);
  const kRattle = decay(0.0016);
  const kBody = decay(p.bodyDecay);
  const kSweep = decay(0.008);
  const kThock = decay(p.thockDecay);
  const kPing = decay(0.014);
  const kRelClick = decay(0.0009);
  const kRelBody = decay(0.008);
  const rattleAt = Math.round(p.rattleAt * sampleRate);
  const releaseAt = Math.round(p.releaseAt * sampleRate);
  const attack = Math.max(1, Math.round(0.0008 * sampleRate));
  const thockStep = (2 * Math.PI * p.thockHz) / sampleRate;
  const pingStep = (2 * Math.PI * p.pingHz) / sampleRate;
  let eClick = 1;
  let eRattle = 0.55;
  let eBody = 1;
  let eSweep = 1;
  let eThock = 1;
  let ePing = 1;
  let eRelClick = 1;
  let eRelBody = 1;

  for (let i = 0; i < n; i++) {
    const noise = rng() * 2 - 1;

    // 1–2. Downstroke: click and body (plus the space bar's rattle).
    let clickEnv = eClick;
    if (p.rattleAt && i >= rattleAt) {
      clickEnv += eRattle;
      eRattle *= kRattle;
    }
    const click = clickHp.next(noise) * clickEnv * p.click;
    const body = bodyBp.next(noise) * eBody * p.body * 2.2;

    // 3. Thock: a sine falling from 1.6× to its pitch over 8 ms, with a short attack,
    //    roughened with a little noise so it reads as plastic, not a pure tone.
    phase += thockStep * (1 + 0.6 * eSweep);
    const thock = Math.sin(phase) * (1 + 0.35 * noise) * Math.min(1, i / attack) * eThock * p.thock;
    pingPhase += pingStep;
    const ping = Math.sin(pingPhase) * ePing * p.ping;

    // 4. Upstroke: a smaller, higher click and body.
    const relNoise = relBp.next(noise);
    const relClick = relHp.next(noise);
    let release = 0;
    if (i >= releaseAt) {
      release = (relClick * eRelClick * 0.8 + relNoise * eRelBody * 1.6) * p.release;
      eRelClick *= kRelClick;
      eRelBody *= kRelBody;
    }

    out[i] = tone.next(click + body + thock + ping + release);
    eClick *= kClick;
    eBody *= kBody;
    eSweep *= kSweep;
    eThock *= kThock;
    ePing *= kPing;
  }

  // Normalise, then fade the last 4 ms so the end never clicks.
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i] ?? 0));
  const gain = peak > 0 ? CLACK_PEAK / peak : 0;
  const fade = Math.min(n, Math.round(0.004 * sampleRate));
  for (let i = 0; i < n; i++) {
    const tail = i >= n - fade ? (n - i) / fade : 1;
    out[i] = (out[i] ?? 0) * gain * tail;
  }
  return out;
}

/** A variant index for this press: random, but never the same one twice in a row. */
export function pickVariant(count: number, last: number, rng: Rng): number {
  if (count <= 1) return 0;
  const i = Math.min(count - 1, Math.floor(rng() * (count - 1)));
  return last >= 0 && i >= last ? i + 1 : i;
}

/** Which sound a key press makes. A real keyboard clacks even when the game ignores the key. */
export function clackFor(input: KeyInput["kind"], outcome: KeyOutcome): ClackKind {
  if (input === "space") return "space";
  if (input === "backspace" || input === "clearWord") return "back";
  return outcome === "wrong" ? "wrong" : "key";
}

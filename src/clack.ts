// Which recorded keystroke to play for a key press, and how to colour it.
// Pure functions; sound.ts does the playing.
import type { Slice } from "./keySprite.ts";
import type { KeyInput, KeyOutcome } from "./types.ts";

export type ClackKind = "key" | "space" | "back" | "wrong";

export type Rng = () => number;

/** Which sound a key press makes. A real keyboard clacks even when the game ignores the key. */
export function clackFor(input: KeyInput["kind"], outcome: KeyOutcome): ClackKind {
  if (input === "space") return "space";
  if (input === "backspace" || input === "clearWord") return "back";
  return outcome === "wrong" ? "wrong" : "key";
}

/** A variant index for this press: random, but never the same one twice in a row. */
export function pickVariant(count: number, last: number, rng: Rng): number {
  if (count <= 1) return 0;
  const i = Math.min(count - 1, Math.floor(rng() * (count - 1)));
  return last >= 0 && i >= last ? i + 1 : i;
}

/** How one kind of press is played from the recording. */
export interface Voicing {
  /** Which group of slices to pick from. */
  readonly from: "key" | "space";
  /** Playback speed range (1 = as recorded; lower is deeper). */
  readonly rate: readonly [number, number];
  /** Level range. */
  readonly gain: readonly [number, number];
  /** Low-pass cutoff in Hz, or 0 for none. A typo is duller. */
  readonly lowpass: number;
}

export const VOICINGS: Readonly<Record<ClackKind, Voicing>> = {
  key: { from: "key", rate: [0.97, 1.03], gain: [0.85, 1], lowpass: 0 },
  space: { from: "space", rate: [0.97, 1.02], gain: [0.9, 1], lowpass: 0 },
  // Backspace: the same keys, a touch higher and lighter.
  back: { from: "key", rate: [1.06, 1.1], gain: [0.7, 0.8], lowpass: 0 },
  // A typo: the same keys, lower and muffled, so you hear the mistake.
  wrong: { from: "key", rate: [0.86, 0.9], gain: [0.85, 0.95], lowpass: 1500 },
};

const between = (rng: Rng, [lo, hi]: readonly [number, number]): number => lo + rng() * (hi - lo);

export interface Press {
  readonly slice: Slice;
  readonly index: number;
  readonly rate: number;
  readonly gain: number;
  readonly lowpass: number;
}

/** Everything needed to play one press: which slice, how fast, how loud, how dull. */
export function planPress(
  kind: ClackKind,
  slices: Readonly<Record<Voicing["from"], readonly Slice[]>>,
  last: number,
  rng: Rng,
): Press | null {
  const v = VOICINGS[kind];
  const list = slices[v.from];
  if (list.length === 0) return null;
  const index = pickVariant(list.length, last, rng);
  const slice = list[index];
  if (!slice) return null;
  return { slice, index, rate: between(rng, v.rate), gain: between(rng, v.gain), lowpass: v.lowpass };
}

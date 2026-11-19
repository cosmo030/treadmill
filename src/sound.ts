// Plays the typing clack. Every variant is synthesised in idle time after the
// page loads; the AudioContext is created on the first key press (browsers only
// allow sound after a user gesture, and that's also when the round starts), so
// a press only has to start a ready-made buffer.
import { clackParams, pickVariant, synthClack, type ClackKind } from "./clack.ts";

export const SOUND_KEY = "treadmill.sound";
const VARIANTS = 6;
const KINDS: readonly ClackKind[] = ["key", "space", "back", "wrong"];
const VOLUME = 0.55;

/**
 * Sound on or off from the saved choice. Without one: on with a real keyboard,
 * off on touch devices, whose on-screen keyboards often click already.
 */
export function soundPreference(saved: string | null, coarsePointer: boolean): boolean {
  if (saved === "on") return true;
  if (saved === "off") return false;
  return !coarsePointer;
}

export interface KeySound {
  readonly enabled: boolean;
  /** Starts audio early on a click or tap, so even the first key press is instant. */
  warm(): void;
  setEnabled(on: boolean): void;
  /** Plays one clack. Call it from the key event itself, so audio can start. */
  play(kind: ClackKind): void;
}

/** Sounds are synthesised at this rate; the AudioContext resamples if its own differs. */
const SYNTH_RATE = 48_000;

export function createKeySound(initiallyOn: boolean, rng: () => number = Math.random): KeySound {
  let enabled = initiallyOn;
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  // Raw samples, synthesised in idle time after load so the first key press doesn't wait.
  const samples = new Map<ClackKind, Float32Array<ArrayBuffer>[]>();
  const buffers = new Map<ClackKind, AudioBuffer[]>();
  const last = new Map<ClackKind, number>();

  function synth(kind: ClackKind): Float32Array<ArrayBuffer>[] {
    let list = samples.get(kind);
    if (!list) {
      list = [];
      for (let i = 0; i < VARIANTS; i++) list.push(synthClack(clackParams(kind, rng), SYNTH_RATE, rng));
      samples.set(kind, list);
    }
    return list;
  }

  /** Synthesises every kind in the background, one per idle slot. */
  function prepare(): void {
    const todo = KINDS.filter((k) => !samples.has(k));
    const idle =
      typeof requestIdleCallback === "function"
        ? (fn: () => void) => requestIdleCallback(fn, { timeout: 1500 })
        : (fn: () => void) => window.setTimeout(fn, 50);
    const next = (): void => {
      const kind = todo.shift();
      if (!kind) return;
      synth(kind);
      idle(next);
    };
    idle(next);
  }

  function ensure(): AudioContext | null {
    if (ctx) {
      if (ctx.state === "suspended") void ctx.resume();
      return ctx;
    }
    if (typeof AudioContext !== "function") return null;
    // iOS 17+: play alongside other audio and respect the silent switch.
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = "ambient";
    try {
      ctx = new AudioContext({ latencyHint: "interactive" });
    } catch {
      return null;
    }
    master = ctx.createGain();
    master.gain.value = VOLUME;
    master.connect(ctx.destination);
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  }

  function buffersFor(c: AudioContext, kind: ClackKind): AudioBuffer[] {
    let list = buffers.get(kind);
    if (!list) {
      list = synth(kind).map((s) => {
        const b = c.createBuffer(1, s.length, SYNTH_RATE);
        b.copyToChannel(s, 0);
        return b;
      });
      buffers.set(kind, list);
    }
    return list;
  }

  function play(kind: ClackKind): void {
    if (!enabled) return;
    const c = ensure();
    if (!c || !master) return;
    const list = buffersFor(c, kind);
    const i = pickVariant(list.length, last.get(kind) ?? -1, rng);
    last.set(kind, i);
    const buffer = list[i];
    if (!buffer) return;
    const src = c.createBufferSource();
    src.buffer = buffer;
    // A little pitch and level wobble on top of the variants.
    src.playbackRate.value = 0.95 + rng() * 0.1;
    const gain = c.createGain();
    gain.gain.value = 0.8 + rng() * 0.2;
    src.connect(gain).connect(master);
    src.start();
  }

  if (enabled) prepare();

  return {
    get enabled() {
      return enabled;
    },
    warm() {
      if (enabled) ensure();
    },
    setEnabled(on) {
      enabled = on;
      // Turning it on is a click: a good moment to unlock audio, with a preview clack.
      if (on) {
        play("key");
        prepare();
      }
    },
    play,
  };
}

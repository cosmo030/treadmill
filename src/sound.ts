// Plays the typing sound: single keystrokes cut from a real recording
// ("keyboard-typing-yellow-switches" by aalorv, CC BY 4.0; see keySprite.ts).
//
// The file is fetched and decoded in idle time after the page loads (an
// OfflineAudioContext can decode before any user gesture). The real
// AudioContext starts on the first gesture, so a key press only has to start
// a slice of a ready buffer.
import { planPress, type ClackKind } from "./clack.ts";
import { KEY_SPRITE } from "./keySprite.ts";

export const SOUND_KEY = "treadmill.sound";
const VOLUME = 0.7;

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
  /** Plays one keystroke. Call it from the key event itself, so audio can start. */
  play(kind: ClackKind): void;
}

export function createKeySound(initiallyOn: boolean, rng: () => number = Math.random): KeySound {
  let enabled = initiallyOn;
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let sprite: AudioBuffer | null = null;
  let loading = false;
  let previewWhenLoaded = false;
  const last = new Map<ClackKind, number>();

  /** Fetches and decodes the recording once: in idle time, or right away when asked for. */
  function load(now = false): void {
    if (sprite || loading) return;
    loading = true;
    const idle =
      now
        ? (fn: () => void) => fn()
        : typeof requestIdleCallback === "function"
          ? (fn: () => void) => requestIdleCallback(fn, { timeout: 1500 })
          : (fn: () => void) => window.setTimeout(fn, 50);
    idle(() => {
      void (async () => {
        try {
          const res = await fetch(KEY_SPRITE.url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.arrayBuffer();
          // Any context can decode; an offline one needs no user gesture.
          const decoder = new OfflineAudioContext(1, 1, 44_100);
          sprite = await decoder.decodeAudioData(data);
          if (previewWhenLoaded) {
            previewWhenLoaded = false;
            play("key");
          }
        } catch {
          // No sound then; the game works the same without it.
          loading = false;
        }
      })();
    });
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

  function play(kind: ClackKind): void {
    if (!enabled) return;
    const c = ensure();
    if (!c || !master || !sprite) return;
    const press = planPress(kind, KEY_SPRITE, last.get(kind) ?? -1, rng);
    if (!press) return;
    last.set(kind, press.index);
    const src = c.createBufferSource();
    src.buffer = sprite;
    src.playbackRate.value = press.rate;
    const gain = c.createGain();
    gain.gain.value = press.gain;
    let node: AudioNode = src;
    if (press.lowpass > 0) {
      const filter = c.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = press.lowpass;
      node = node.connect(filter);
    }
    node.connect(gain).connect(master);
    const [start, duration] = press.slice;
    src.start(0, start, duration);
  }

  if (enabled) load();

  return {
    get enabled() {
      return enabled;
    },
    warm() {
      if (enabled) ensure();
    },
    setEnabled(on) {
      enabled = on;
      if (on) {
        // Turning it on is a click: start audio now (allowed during a gesture) and
        // play a preview, straight away or as soon as the recording has loaded.
        ensure();
        if (sprite) play("key");
        else {
          previewWhenLoaded = true;
          load(true);
        }
      }
    },
    play,
  };
}

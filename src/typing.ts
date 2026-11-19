// Input handling, word tracking and stats. No DOM in here, so it's all testable.
import type { KeyInput, KeyOutcome, LetterState, Stats } from "./types.ts";
import { randomWords, type Rng } from "./words.ts";

/** Always keep at least this many words ahead of the player. */
export const LOOKAHEAD = 40;
/** Extra letters past the end of a word are capped so one word can't grow forever. */
export const MAX_EXTRA = 12;
/** Window for the live speed that drives the runner. */
export const LIVE_WINDOW_MS = 3000;

// ---------------------------------------------------------------------------
// Session: the words, what was typed, and the keystroke counters.
// ---------------------------------------------------------------------------

export class TypingSession {
  /** The target words. Grows as the player moves along. */
  readonly words: string[];
  /** What was typed for each word so far. `typed[index]` is the current word. */
  readonly typed: string[] = [""];
  index = 0;
  totalKeystrokes = 0;
  correctKeystrokes = 0;
  stumbles = 0;
  /** Times (ms) of every correct keystroke, for the live speed. */
  readonly hits: number[] = [];

  private readonly rng: Rng;

  constructor(rng: Rng = Math.random) {
    this.rng = rng;
    this.words = randomWords(LOOKAHEAD + 20, rng);
  }

  get target(): string {
    return this.words[this.index] ?? "";
  }

  get current(): string {
    return this.typed[this.index] ?? "";
  }

  press(input: KeyInput, now: number): KeyOutcome {
    switch (input.kind) {
      case "char":
        return this.typeChar(input.char, now);
      case "space":
        return this.advance(now);
      case "backspace":
        return this.edit(this.current.slice(0, -1));
      case "clearWord":
        return this.edit("");
    }
  }

  private typeChar(char: string, now: number): KeyOutcome {
    if (char.length !== 1 || char === " ") return "ignored";
    const target = this.target;
    const typed = this.current;
    if (typed.length >= target.length + MAX_EXTRA) return "ignored";
    const correct = typed.length < target.length && target[typed.length] === char;
    this.totalKeystrokes++;
    if (correct) {
      this.correctKeystrokes++;
      this.hits.push(now);
    } else {
      this.stumbles++;
    }
    this.typed[this.index] = typed + char;
    return correct ? "correct" : "wrong";
  }

  /** Space: commit the current word and move on. Ignored on an empty word. */
  private advance(now: number): KeyOutcome {
    const typed = this.current;
    if (typed === "") return "ignored";
    this.totalKeystrokes++;
    if (typed === this.target) {
      this.correctKeystrokes++;
      this.hits.push(now);
    }
    this.index++;
    this.typed.push("");
    this.topUp();
    return "advanced";
  }

  /** Backspace only ever changes the current word, never earlier ones. */
  private edit(next: string): KeyOutcome {
    if (this.current === "" || next === this.current) return "ignored";
    this.typed[this.index] = next;
    return "deleted";
  }

  private topUp(): void {
    while (this.words.length - this.index < LOOKAHEAD) {
      this.words.push(...randomWords(20, this.rng, this.words[this.words.length - 1]));
    }
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export interface Letter {
  readonly char: string;
  readonly state: LetterState;
}

/** How to colour each letter of a word. Extra letters past the end come out as "extra". */
export function letterStates(target: string, typed: string): Letter[] {
  const out: Letter[] = [];
  const len = Math.max(target.length, typed.length);
  for (let i = 0; i < len; i++) {
    const t = target[i];
    const c = typed[i];
    if (c === undefined) out.push({ char: t ?? "", state: "untyped" });
    else if (t === undefined) out.push({ char: c, state: "extra" });
    else out.push({ char: t, state: c === t ? "correct" : "wrong" });
  }
  return out;
}

/**
 * Characters that count towards WPM: every correctly typed, completed word plus
 * the space after it. With `includeCurrent`, a word that's fully and exactly
 * typed when time runs out counts too (without a space; none was typed).
 */
export function correctChars(
  words: readonly string[],
  typed: readonly string[],
  index: number,
  includeCurrent: boolean,
): number {
  let n = 0;
  for (let i = 0; i < index; i++) {
    const w = words[i];
    if (w !== undefined && typed[i] === w) n += w.length + 1;
  }
  const cur = words[index];
  if (includeCurrent && cur !== undefined && typed[index] === cur) n += cur.length;
  return n;
}

/** Words per minute: characters ÷ 5 ÷ minutes, rounded to a whole number. */
export function wpm(chars: number, elapsedMs: number): number {
  if (elapsedMs <= 0 || chars <= 0) return 0;
  return Math.round(chars / 5 / (elapsedMs / 60_000));
}

/**
 * Correct keystrokes as a percentage of all keystrokes. Rounded down, so a
 * single mistake never shows as 100%. No keystrokes at all counts as 100.
 */
export function accuracy(correct: number, total: number): number {
  if (total <= 0) return 100;
  return Math.floor((correct / total) * 100);
}

/**
 * Raw live speed: correct keystrokes in the last few seconds, as WPM. Early in
 * a round the window is shorter (but at least one second) so it doesn't start low.
 */
export function rollingWpm(
  hits: readonly number[],
  now: number,
  startedAt: number,
  windowMs = LIVE_WINDOW_MS,
): number {
  const span = Math.min(windowMs, Math.max(1000, now - startedAt));
  let count = 0;
  for (let i = hits.length - 1; i >= 0; i--) {
    const t = hits[i];
    if (t === undefined || t <= now - span) break;
    if (t <= now) count++;
  }
  return count / 5 / (span / 60_000);
}

/** Exponential smoothing that behaves the same at any frame rate. */
export function smoothTowards(prev: number, target: number, dtMs: number, tauMs = 700): number {
  if (dtMs <= 0) return prev;
  return prev + (target - prev) * (1 - Math.exp(-dtMs / tauMs));
}

/** Stats for a session after `elapsedMs`. `final` counts a finished last word. */
export function computeStats(s: TypingSession, elapsedMs: number, final: boolean): Stats {
  const chars = correctChars(s.words, s.typed, s.index, final);
  return {
    wpm: wpm(chars, elapsedMs),
    accuracy: accuracy(s.correctKeystrokes, s.totalKeystrokes),
    stumbles: s.stumbles,
    correctChars: chars,
    correctKeystrokes: s.correctKeystrokes,
    totalKeystrokes: s.totalKeystrokes,
    elapsedMs,
  };
}

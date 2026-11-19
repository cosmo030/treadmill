// The round itself: ready → running → finished, the 30-second clock, and the
// smoothed live speed. Time is passed in, so tests can run it without waiting.
import type { GameState, KeyInput, KeyOutcome, Phase, Stats } from "./types.ts";
import { computeStats, rollingWpm, smoothTowards, TypingSession } from "./typing.ts";
import type { Rng } from "./words.ts";

export const ROUND_MS = 30_000;

export class Game {
  state: GameState = { phase: "ready" };
  session: TypingSession;
  /** Smoothed live WPM for the runner and the console. */
  liveWpm = 0;

  private readonly rng: Rng;
  private readonly durationMs: number;
  private lastTick = 0;

  constructor(rng: Rng = Math.random, durationMs = ROUND_MS) {
    this.rng = rng;
    this.durationMs = durationMs;
    this.session = new TypingSession(rng);
  }

  /** Feed a key. The first letter typed starts the clock. */
  press(input: KeyInput, now: number): KeyOutcome {
    const state = this.state;
    if (state.phase === "finished") return "ignored";
    if (state.phase === "running" && now - state.startedAt >= this.durationMs) {
      this.finish(state.startedAt);
      return "ignored";
    }
    if (state.phase === "ready") {
      if (input.kind !== "char") return "ignored";
      this.state = { phase: "running", startedAt: now };
      this.lastTick = now;
    }
    return this.session.press(input, now);
  }

  /** Advance the clock. Returns true on the tick that ends the round. */
  tick(now: number): boolean {
    const state = this.state;
    if (state.phase !== "running") return false;
    const raw = rollingWpm(this.session.hits, now, state.startedAt);
    this.liveWpm = smoothTowards(this.liveWpm, raw, now - this.lastTick);
    this.lastTick = now;
    if (now - state.startedAt >= this.durationMs) {
      this.finish(state.startedAt);
      return true;
    }
    return false;
  }

  /** Back to ready with a fresh word stream. Works in any state. */
  restart(): void {
    this.state = { phase: "ready" };
    this.session = new TypingSession(this.rng);
    this.liveWpm = 0;
  }

  get phase(): Phase {
    return this.state.phase;
  }

  remainingMs(now: number): number {
    const s = this.state;
    if (s.phase === "ready") return this.durationMs;
    if (s.phase === "finished") return 0;
    return Math.max(0, this.durationMs - (now - s.startedAt));
  }

  elapsedMs(now: number): number {
    const s = this.state;
    if (s.phase === "ready") return 0;
    if (s.phase === "finished") return s.endedAt - s.startedAt;
    return Math.min(this.durationMs, now - s.startedAt);
  }

  /** Stats so far (during a round) or the final ones. */
  stats(now: number): Stats {
    const s = this.state;
    if (s.phase === "finished") return s.stats;
    return computeStats(this.session, this.elapsedMs(now), false);
  }

  private finish(startedAt: number): void {
    const endedAt = startedAt + this.durationMs;
    this.state = {
      phase: "finished",
      startedAt,
      endedAt,
      stats: computeStats(this.session, this.durationMs, true),
    };
  }
}

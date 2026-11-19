// Shared types: game state, stats, keyboard input and the runner's poses.

/** A point in canvas space (logical units, before device-pixel scaling). */
export type Point = readonly [x: number, y: number];

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------

export interface Stats {
  /** Net words per minute: correct characters ÷ 5 ÷ minutes, rounded. */
  wpm: number;
  /** Correct keystrokes ÷ all keystrokes, 0–100, rounded. */
  accuracy: number;
  /** Wrong letter keystrokes. Every one of them trips the runner. */
  stumbles: number;
  /** Characters that count towards WPM (correct words plus their spaces). */
  correctChars: number;
  correctKeystrokes: number;
  totalKeystrokes: number;
  elapsedMs: number;
}

export type GameState =
  | { readonly phase: "ready" }
  | { readonly phase: "running"; readonly startedAt: number }
  | { readonly phase: "finished"; readonly startedAt: number; readonly endedAt: number; readonly stats: Stats };

export type Phase = GameState["phase"];

/** One normalised key press, from a physical keyboard or a phone's input events. */
export type KeyInput =
  | { readonly kind: "char"; readonly char: string }
  | { readonly kind: "space" }
  | { readonly kind: "backspace" }
  | { readonly kind: "clearWord" };

/** What a key press did, so the UI and the runner can react. */
export type KeyOutcome = "correct" | "wrong" | "advanced" | "deleted" | "ignored";

/** Letter state for rendering the words. */
export type LetterState = "untyped" | "correct" | "wrong" | "extra";

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/** How the figure moves, picked from the live WPM. */
export type Gait = "stand" | "walk" | "jog" | "run" | "sprint";

/**
 * Limb angles in degrees, measured from straight down; positive points forward
 * (to the right, the way the runner faces). Thigh/shin and upper arm/forearm are
 * absolute angles, so a shin of -90 sticks straight out behind.
 */
export interface LimbAngles {
  readonly upper: number;
  readonly lower: number;
}

/** One keyframe of the run cycle: both legs and both arms. */
export interface RunFrame {
  readonly legNear: LimbAngles;
  readonly legFar: LimbAngles;
  readonly armNear: LimbAngles;
  readonly armFar: LimbAngles;
}

/** A full pose, ready to turn into joint positions. */
export interface Pose extends RunFrame {
  /** Torso lean in degrees, positive = forward. */
  readonly lean: number;
  /** Extra vertical offset of the hip (negative = up), on top of foot grounding. */
  readonly lift: number;
}

/** Joint positions in canvas space, the result of forward kinematics. */
export interface Skeleton {
  readonly head: Point;
  readonly neck: Point;
  readonly shoulder: Point;
  readonly hip: Point;
  readonly kneeNear: Point;
  readonly footNear: Point;
  readonly kneeFar: Point;
  readonly footFar: Point;
  readonly elbowNear: Point;
  readonly handNear: Point;
  readonly elbowFar: Point;
  readonly handFar: Point;
}

/** Everything the runner needs from the game each frame. */
export interface RunnerInput {
  readonly phase: Phase;
  /** Smoothed live WPM that drives the motion. */
  readonly liveWpm: number;
  /** The number on the console: live WPM while running, the final WPM after. */
  readonly consoleWpm: number;
  readonly remainingSeconds: number;
  readonly elapsedSeconds: number;
  /** True when the round that just finished set a new personal best. */
  readonly newBest: boolean;
}

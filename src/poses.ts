// The runner's poses: run-cycle keyframes, speed → gait mapping and forward
// kinematics. Pure functions, no canvas; runner.ts does the drawing.
//
// Proportions match hangman's figure: head radius 20, neck 20 + 16, torso 52,
// arms ~40, legs ~48. Hangman's limbs are single straight lines; here each limb
// gets a knee or elbow so the run cycle reads, but standing still it's the same
// figure in the same stance.
import type { Gait, LimbAngles, Point, Pose, RunFrame, Skeleton } from "./types.ts";

export const HEAD_R = 20;
const HEAD_OFF = 20; // neck → head centre
const NECK = 16; // shoulder → neck
const TORSO = 52; // hip → shoulder
const THIGH = 24;
const SHIN = 24;
const UPPER_ARM = 20;
const FOREARM = 20;

/** Number of keyframes in one full stride (two steps). */
export const FRAMES = 6;

const L = (upper: number, lower: number): LimbAngles => ({ upper, lower });

// One leg through a whole stride. The other leg is the same, half a stride later.
// Arms swing against the leg on the same side.
const WALK_LEG: readonly LimbAngles[] = [L(28, 22), L(12, 8), L(-6, -4), L(-24, -34), L(4, -48), L(25, 8)];
const RUN_LEG: readonly LimbAngles[] = [L(30, 14), L(8, -6), L(-24, -38), L(-26, -100), L(16, -72), L(52, -8)];
const WALK_ARM: readonly LimbAngles[] = [L(-26, -14), L(-12, -4), L(6, 10), L(26, 40), L(12, 26), L(-10, 0)];
const RUN_ARM: readonly LimbAngles[] = [L(-40, 30), L(-20, 62), L(14, 112), L(40, 140), L(16, 100), L(-26, 42)];
/** Little hop in the airborne frames of a run (hip offset, negative = up). */
const RUN_LIFT: readonly number[] = [0, 1, -3, 0, 1, -3];

/** Standing still, same stance as hangman's calm figure. */
export const STAND: Pose = {
  legNear: L(19, 19),
  legFar: L(-19, -19),
  armNear: L(34, 34),
  armFar: L(-34, -34),
  lean: 0,
  lift: 0,
};

/** End of the round: bent over, hands dangling near the knees, panting. */
export const PANT: Pose = {
  legNear: L(30, -4),
  legFar: L(8, -8),
  armNear: L(-6, -14),
  armFar: L(-16, -22),
  lean: 52,
  lift: 0,
};

/** New personal best: arms up. */
export const VICTORY: Pose = {
  legNear: L(16, 14),
  legFar: L(-16, -14),
  armNear: L(124, 146),
  armFar: L(-124, -146),
  lean: -3,
  lift: 0,
};

/** Arms flailing during a stumble, two frames to alternate. */
export const FLAIL: readonly [RunFrame["armNear"], RunFrame["armFar"]][] = [
  [L(118, 78), L(-128, -158)],
  [L(150, 120), L(-96, -128)],
];

// ---------------------------------------------------------------------------
// Speed → gait
// ---------------------------------------------------------------------------

export function gaitFor(wpm: number): Gait {
  if (wpm < 1) return "stand";
  if (wpm < 30) return "walk";
  if (wpm < 60) return "jog";
  if (wpm < 90) return "run";
  return "sprint";
}

/** Continuous blend values for a speed, so gait changes never snap. */
export interface Motion {
  /** 0 = standing pose, 1 = full stride. Ramps up over the first few WPM. */
  stride: number;
  /** 0 = walk keyframes, 1 = run keyframes. Walk → jog → run. */
  run: number;
  /** 0–1, how far into a sprint. Bigger stride, more lean. */
  sprint: number;
  /** Forward lean of the torso, degrees. */
  lean: number;
  /** Strides per second. */
  cadence: number;
  /** Belt speed, logical px per second. */
  beltSpeed: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function motionFor(wpm: number): Motion {
  const v = Math.max(0, wpm);
  const stride = clamp(v / 8, 0, 1);
  const run = clamp((v - 22) / 48, 0, 1); // 22 WPM still walks, 70 fully runs
  const sprint = clamp((v - 85) / 25, 0, 1);
  const lean = 2 + run * 10 + sprint * 8;
  const cadence = v <= 0 ? 0 : 0.75 + v / 55;
  // How far a planted foot travels per stride grows with the gait.
  const strideLength = 64 + run * 56 + sprint * 26;
  return { stride, run, sprint, lean, cadence, beltSpeed: cadence * strideLength * stride };
}

// ---------------------------------------------------------------------------
// Keyframes → pose
// ---------------------------------------------------------------------------

const at = <T>(list: readonly T[], i: number): T => {
  const v = list[((i % list.length) + list.length) % list.length];
  if (v === undefined) throw new Error("empty keyframe list");
  return v;
};

const mixLimb = (a: LimbAngles, b: LimbAngles, t: number): LimbAngles => L(lerp(a.upper, b.upper, t), lerp(a.lower, b.lower, t));
const scaleLimb = (a: LimbAngles, s: number): LimbAngles => L(a.upper * s, a.lower * s);

export function mixPose(a: Pose, b: Pose, t: number): Pose {
  return {
    legNear: mixLimb(a.legNear, b.legNear, t),
    legFar: mixLimb(a.legFar, b.legFar, t),
    armNear: mixLimb(a.armNear, b.armNear, t),
    armFar: mixLimb(a.armFar, b.armFar, t),
    lean: lerp(a.lean, b.lean, t),
    lift: lerp(a.lift, b.lift, t),
  };
}

/**
 * The pose for keyframe `frame` (0–5) at a given motion. Frames are stepped,
 * not interpolated in time; only the gait blend is continuous.
 */
export function cyclePose(frame: number, m: Motion): Pose {
  const leg = (i: number): LimbAngles => {
    const walk = at(WALK_LEG, i);
    const run = at(RUN_LEG, i);
    return scaleLimb(mixLimb(walk, run, m.run), 1 + m.sprint * 0.15);
  };
  const arm = (i: number): LimbAngles => {
    const walk = at(WALK_ARM, i);
    const run = at(RUN_ARM, i);
    return scaleLimb(mixLimb(walk, run, m.run), 1 + m.sprint * 0.1);
  };
  const far = frame + FRAMES / 2;
  const moving: Pose = {
    legNear: leg(frame),
    legFar: leg(far),
    // Each arm swings opposite its own leg, i.e. with the other leg.
    armNear: arm(far),
    armFar: arm(frame),
    lean: m.lean,
    lift: at(RUN_LIFT, frame) * m.run,
  };
  return mixPose(STAND, moving, m.stride);
}

// ---------------------------------------------------------------------------
// Forward kinematics
// ---------------------------------------------------------------------------

/** Unit vector for an angle measured from straight down, positive = forward. */
const dir = (deg: number): Point => {
  const r = (deg * Math.PI) / 180;
  return [Math.sin(r), Math.cos(r)];
};

const add = (p: Point, d: Point, len: number): Point => [p[0] + d[0] * len, p[1] + d[1] * len];

/**
 * Joint positions for a pose. The hip is placed so the lowest foot stands on
 * `groundY`, then `pose.lift` and `offset` are added on top.
 */
export function skeleton(pose: Pose, hipX: number, groundY: number, offset: Point = [0, 0]): Skeleton {
  const legY = (a: LimbAngles): number => THIGH * Math.cos((a.upper * Math.PI) / 180) + SHIN * Math.cos((a.lower * Math.PI) / 180);
  const drop = Math.max(legY(pose.legNear), legY(pose.legFar));
  const hip: Point = [hipX + offset[0], groundY - drop + pose.lift + offset[1]];

  const up = dir(180 - pose.lean); // torso direction: up, tilted forward by the lean
  const shoulder = add(hip, up, TORSO);
  const neck = add(shoulder, up, NECK);
  const head = add(neck, up, HEAD_OFF);

  const limb = (from: Point, a: LimbAngles, l1: number, l2: number): [Point, Point] => {
    const mid = add(from, dir(a.upper), l1);
    return [mid, add(mid, dir(a.lower), l2)];
  };
  const [kneeNear, footNear] = limb(hip, pose.legNear, THIGH, SHIN);
  const [kneeFar, footFar] = limb(hip, pose.legFar, THIGH, SHIN);
  const [elbowNear, handNear] = limb(shoulder, pose.armNear, UPPER_ARM, FOREARM);
  const [elbowFar, handFar] = limb(shoulder, pose.armFar, UPPER_ARM, FOREARM);

  return { head, neck, shoulder, hip, kneeNear, footNear, kneeFar, footFar, elbowNear, handNear, elbowFar, handFar };
}

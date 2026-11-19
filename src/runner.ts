// The runner on the treadmill. Drawn with Rough.js on a canvas and redrawn at a
// low, choppy frame rate so the lines "boil" like a hand-drawn cartoon (same
// setup as hangman's figure.js). The run cycle steps through keyframes like a
// flipbook; its speed follows the live WPM, and every typo trips the figure.
import rough from "roughjs";
import type { RoughCanvas } from "roughjs/bin/canvas";
import type { Options } from "roughjs/bin/core";
import {
  cyclePose,
  FLAIL,
  FRAMES,
  gaitFor,
  HEAD_R,
  mixPose,
  motionFor,
  PANT,
  skeleton,
  STAND,
  VICTORY,
} from "./poses.ts";
import { atRest, isResting, stepSpring, type Spring } from "./spring.ts";
import {
  createTie,
  kickTie,
  pinTie,
  settleTie,
  staticTie,
  staticTieAngle,
  stepTie,
  tieForces,
  type Tie,
  type TieMood,
} from "./tie.ts";
import type { Point, Pose, RunnerInput, Skeleton } from "./types.ts";
import { smoothTowards } from "./typing.ts";

export const W = 480;
export const H = 232;

const BELT_Y = 186; // where the feet land
const BELT_X0 = 62;
const BELT_X1 = 356;
const HIP_X = 206;
const TICK_GAP = 26;

const BOIL_MS = 100; // ~10 new drawings per second
const FAST_MS = 50; // while stumbling
const BOIL_SEEDS = [11, 29, 47, 83];

const STUMBLE_MS = 380;
const BIG_STUMBLE_MS = 900;
const TRIP_KICK = 37; // spring velocity → peaks around 1
const BIG_TRIP_KICK = 52;
const BIG_AFTER = 3; // typos within BIG_WINDOW_MS make a big stumble
const BIG_WINDOW_MS = 1500;

/** Logical-pixel positions of the treadmill console's LCD. */
const LCD = { x: 374, y: 58, w: 80, h: 38 };

type Rough = Options;

interface Puff {
  x: number;
  y: number;
  born: number;
  size: number;
}

interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number): number => clamp(v, 0, 1);
const pt = (p: Point): [number, number] => [p[0], p[1]];

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface Runner {
  /** A wrong keystroke: trip forward, flail, spring back. */
  stumble(): void;
  /** Back to standing on a stopped treadmill (new round). */
  reset(): void;
  /** Redraw now, e.g. after a theme change. */
  redraw(): void;
  destroy(): void;
}

export function createRunner(canvas: HTMLCanvasElement, source: () => RunnerInput): Runner {
  const maybeCtx = canvas.getContext("2d");
  if (!maybeCtx) throw new Error("canvas 2d context unavailable");
  const ctx: CanvasRenderingContext2D = maybeCtx;
  const rc: RoughCanvas = rough.canvas(canvas);
  const motionQuery = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  let reduce = prefersReducedMotion();

  const s = {
    speed: 0, // smoothed WPM driving the motion
    phase: 0, // run-cycle position in keyframes (continuous; drawn stepped)
    belt: 0, // belt offset, logical px
    trip: atRest() as Spring,
    stumbleUntil: 0,
    bigUntil: 0,
    typos: [] as number[],
    puffs: [] as Puff[],
    drops: [] as Drop[],
    nextDrop: 0,
    blinkUntil: 0,
    nextBlink: performance.now() + rand(1200, 3500),
    endSince: 0, // when the end pose (panting / victory) started, 0 = not ending
    lastPose: STAND as Pose,
    tie: null as Tie | null, // created on the first draw, once the collar is known
    collar: null as Point | null, // where the tie's knot is pinned, updated every draw
    victoryKicked: false,
  };

  let raf = 0;
  let lastStep = performance.now();
  let lastDraw = 0;
  let lastFrameIdx = -1;
  let scale = 1;

  // --- sizing -------------------------------------------------------------
  function resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cssW = canvas.clientWidth || W;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round((cssW * H * dpr) / W);
    scale = canvas.width / W;
    draw(performance.now());
  }
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
  ro?.observe(canvas);

  // --- reactions ----------------------------------------------------------
  function stumble(): void {
    const now = performance.now();
    s.typos = s.typos.filter((t) => now - t < BIG_WINDOW_MS);
    s.typos.push(now);
    const big = s.typos.length >= BIG_AFTER;
    // Restart the stumble instead of stacking: velocity is set, not added.
    s.trip = { x: Math.max(0, s.trip.x * 0.5), v: big ? BIG_TRIP_KICK : TRIP_KICK };
    s.stumbleUntil = now + STUMBLE_MS;
    if (big) s.bigUntil = now + BIG_STUMBLE_MS;
    if (!reduce) {
      // The tie whips forward and up into his face, then falls back on its own.
      if (s.tie) kickTie(s.tie, big ? 470 : 360, big ? -950 : -720);
      const foot = BELT_Y - 2;
      const x = HIP_X + 14;
      s.puffs = s.puffs.filter((p) => now - p.born < 450).slice(-6);
      for (const [dx, size] of [[-8, 7], [2, 10], [12, 6]] as const) {
        s.puffs.push({ x: x + dx + rand(-2, 2), y: foot, born: now, size: size * (big ? 1.4 : 1) });
      }
    }
    draw(now);
    lastDraw = now;
  }

  function reset(): void {
    s.speed = 0;
    s.phase = 0;
    s.trip = atRest();
    s.stumbleUntil = 0;
    s.bigUntil = 0;
    s.typos = [];
    s.puffs = [];
    s.drops = [];
    s.endSince = 0;
    s.lastPose = STAND;
    s.victoryKicked = false;
    if (s.tie && s.collar) settleTie(s.tie, s.collar);
    draw(performance.now());
  }

  /** What the tie is doing, from the round and the figure's state. */
  function tieMood(input: RunnerInput): TieMood {
    if (s.endSince) return input.newBest ? "victory" : "limp";
    if (input.phase === "finished") return "limp"; // winding down, out of breath
    return s.speed < 1 ? "stand" : "move";
  }

  // --- simulation ---------------------------------------------------------
  function step(dt: number, now: number, input: RunnerInput): void {
    const target = input.phase === "running" ? input.liveWpm : 0;
    // A second layer of smoothing on top of the game's, so gaits blend slowly.
    // When the round ends the treadmill winds down a bit quicker.
    s.speed = smoothTowards(s.speed, target, dt * 1000, input.phase === "finished" ? 280 : 550);
    if (s.speed < 0.3 && target === 0) s.speed = 0;

    const m = motionFor(s.speed);
    const stumbling = now < s.stumbleUntil;
    const rate = reduce ? Math.min(m.cadence, 0.6) : m.cadence * (stumbling ? 1.5 : 1);
    s.phase = (s.phase + rate * FRAMES * dt) % (FRAMES * 1000);
    s.belt = (s.belt + m.beltSpeed * dt * (reduce ? 0.5 : 1)) % (TICK_GAP * 1000);

    if (!reduce) s.trip = stepSpring(s.trip, dt);

    // End of the round: once the belt has nearly stopped, bend over (or cheer).
    const ending = input.phase === "finished" && s.speed < 15;
    if (ending && !s.endSince) s.endSince = now;
    if (!ending) s.endSince = 0;

    // The tie: simulated every frame (drawn at the choppy rate like the rest).
    if (s.tie && s.collar && !reduce) {
      const mood = tieMood(input);
      if (mood === "victory" && !s.victoryKicked) {
        kickTie(s.tie, -520, -1000); // swings up with his arms, out past his shoulder
        s.victoryKicked = true;
      }
      let forces = tieForces(mood, s.speed, m.sprint, s.tie.time);
      // Victory: an updraft holds it up while the arms go up, then it drops back down.
      if (mood === "victory" && now - s.endSince < 1300) {
        const hold = Math.min(1, 1.6 * (1 - (now - s.endSince) / 1300));
        forces = { ...forces, windX: -1150 * hold, windY: -1550 * hold, flap: 300 * hold, flapHz: 6 };
      }
      if (stumbling) forces = { ...forces, windX: forces.windX * 0.25, windY: forces.windY * 0.25, flap: forces.flap * 0.5 };
      stepTie(s.tie, s.collar, forces, dt);
    }

    // Blinking (standing, walking, or panting at the end).
    if (now > s.nextBlink) {
      s.blinkUntil = now + 140;
      s.nextBlink = now + rand(2000, 5000) * (reduce ? 1.5 : 1);
    }

    // Sweat: after 15 seconds of running, at high speed, and while panting.
    const sweaty =
      (input.phase === "running" && (input.elapsedSeconds >= 15 || s.speed >= 80)) ||
      (ending && !input.newBest);
    if (!reduce) {
      s.drops = s.drops.filter((d) => now - d.born < 700);
      for (const d of s.drops) {
        d.vy += 260 * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
      }
      const max = s.speed >= 80 || ending ? 3 : 2;
      if (sweaty && s.drops.length < max && now > s.nextDrop) {
        const side = ending ? (Math.random() < 0.5 ? -1 : 1) : -1;
        s.drops.push({
          x: side * (HEAD_R + 3),
          y: rand(-8, 2),
          vx: ending ? side * 6 : -rand(30, 60) - s.speed * 0.4,
          vy: ending ? 10 : rand(-30, -5),
          born: now,
        });
        s.nextDrop = now + rand(220, 600);
      }
      if (!sweaty) s.drops = [];
    }
  }

  function isBusy(now: number): boolean {
    return !isResting(s.trip) || now < s.stumbleUntil || s.puffs.length > 0;
  }

  // --- pose for this frame ------------------------------------------------
  function currentPose(now: number, input: RunnerInput, boilTick: number): { pose: Pose; offset: Point } {
    const m = motionFor(s.speed);
    let offset: [number, number] = [0, 0];
    let pose: Pose;

    if (s.endSince) {
      const t = now - s.endSince;
      const target = input.newBest ? VICTORY : PANT;
      pose = mixPose(s.lastPose, target, reduce ? 1 : clamp01(t / 260));
      if (!reduce) {
        if (input.newBest) {
          // Two happy hops, then a small one now and then (like hangman's win).
          const hop = (start: number, len: number, height: number): void => {
            const u = (t - start) / len;
            if (u > 0 && u < 1) offset[1] -= height * 4 * u * (1 - u);
          };
          hop(260, 260, 12);
          hop(520, 220, 7);
          const loop = (t - 740) % 2600;
          if (t > 740 && loop > 2300) hop(t - loop + 2300, 300, 6);
        } else {
          // Panting: the back heaves about twice a second.
          const heave = Math.floor(t / 230) % 2;
          pose = { ...pose, lean: pose.lean + (heave ? 3 : 0), lift: pose.lift + (heave ? 1.5 : 0) };
        }
      }
      return { pose, offset };
    }

    if (s.speed <= 0) {
      pose = STAND;
      // Waiting: a small bounce on the boil beat.
      if (!reduce && input.phase === "ready") offset[1] = [0, -1, -2, -1][boilTick % 4] ?? 0;
    } else {
      const frame = reduce ? (Math.floor(s.phase / 3) % 2) * 3 : Math.floor(s.phase) % FRAMES;
      pose = cyclePose(frame, m);
    }
    s.lastPose = pose;

    // Stumble: pitch forward, flail, spring back with overshoot.
    const stumbling = now < s.stumbleUntil;
    if (reduce) {
      if (stumbling) pose = { ...pose, lean: pose.lean + 10 };
    } else {
      const x = clamp(s.trip.x, -0.5, 1.6);
      if (x !== 0) {
        pose = { ...pose, lean: pose.lean + 26 * x, lift: pose.lift + 4 * Math.max(0, x) };
        offset = [offset[0] + 7 * x, offset[1]];
      }
    }
    if (stumbling) {
      const flail = FLAIL[reduce ? 0 : Math.floor(now / FAST_MS) % FLAIL.length];
      if (flail) {
        // Ease back to the normal arm swing over the last part of the stumble.
        const w = clamp01((s.stumbleUntil - now) / 140);
        const arms: Pose = { ...pose, armNear: flail[0], armFar: flail[1] };
        pose = mixPose(pose, arms, w);
      }
    }
    return { pose, offset };
  }

  // --- drawing ------------------------------------------------------------
  function colors(): { ink: string; accent: string; lcdBg: string; lcdInk: string; ground: string } {
    const cs = getComputedStyle(canvas);
    const v = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback;
    return {
      ink: v("--ink", "#121212"),
      // cosmo030.com's orange (--color-signal there). The tie's colour.
      accent: v("--accent", "#ff5a1f"),
      lcdBg: v("--lcd-bg", "#a7ad97"),
      lcdInk: v("--lcd-ink", "#1b2014"),
      ground: v("--ground", "#9b9b98"),
    };
  }

  function draw(now: number): void {
    const input = source();
    const c = colors();
    const boilTick = Math.floor(now / BOIL_MS);
    const seedBase = reduce ? (BOIL_SEEDS[0] ?? 11) : (BOIL_SEEDS[boilTick % BOIL_SEEDS.length] ?? 11);
    let n = 0;
    const o = (extra: Rough = {}): Rough => ({
      stroke: c.ink,
      strokeWidth: 2,
      roughness: 1.6,
      bowing: 1.3,
      seed: seedBase + n++ * 7,
      ...extra,
    });

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.lineCap = "round";
    ctx.globalAlpha = 1;

    const { pose, offset } = currentPose(now, input, boilTick);
    const sk = skeleton(pose, HIP_X, BELT_Y, offset);
    // The tie's knot sits just under the chin.
    s.collar = [sk.neck[0] + (sk.shoulder[0] - sk.neck[0]) * 0.3, sk.neck[1] + (sk.shoulder[1] - sk.neck[1]) * 0.3];
    if (!s.tie) s.tie = createTie(s.collar);
    else pinTie(s.tie, s.collar);
    const tiePts: readonly Point[] = reduce
      ? staticTie(s.collar, staticTieAngle(tieMood(input), s.speed, pose.lean))
      : s.tie.pts;

    drawTreadmillBase(o);
    drawSpeedLines(sk, o);
    drawFigure(sk, o, 0.45, tiePts, c.accent); // far limbs, faint
    drawRail(o);
    drawFigure(sk, o, 1, tiePts, c.accent);
    drawFace(now, input, sk, o);
    drawEffects(now, sk, o, c.accent);
    drawConsole(input, o, c);
  }

  function drawTreadmillBase(o: (e?: Rough) => Rough): void {
    // Floor.
    ctx.globalAlpha = 0.35;
    rc.line(18, 222, 464, 222, o({ strokeWidth: 1.4, roughness: 1 }));
    ctx.globalAlpha = 1;

    // Belt: top and bottom runs with a roller at each end.
    const y0 = BELT_Y;
    const y1 = BELT_Y + 14;
    rc.line(BELT_X0, y0, BELT_X1, y0, o({ strokeWidth: 2.2 }));
    rc.line(BELT_X0, y1, BELT_X1, y1, o({ strokeWidth: 2.2 }));
    rc.circle(BELT_X0, y0 + 7, 15, o({ strokeWidth: 2 }));
    rc.circle(BELT_X1, y0 + 7, 15, o({ strokeWidth: 2 }));
    rc.circle(BELT_X0, y0 + 7, 2.5, o({ strokeWidth: 1.4, roughness: 0.4 }));
    rc.circle(BELT_X1, y0 + 7, 2.5, o({ strokeWidth: 1.4, roughness: 0.4 }));

    // Belt marks moving left with the belt.
    const offset = s.belt % TICK_GAP;
    for (let x = BELT_X0 + 12 - offset + TICK_GAP; x < BELT_X1 - 8; x += TICK_GAP) {
      rc.line(x, y0 + 4, x - 3, y1 - 4, o({ strokeWidth: 1.3, roughness: 0.9 }));
    }

    // Frame under the belt and two feet.
    rc.line(BELT_X0 - 14, y1 + 7, BELT_X1 + 18, y1 + 7, o({ strokeWidth: 2.4 }));
    rc.line(BELT_X0 - 2, y1 + 7, BELT_X0 - 7, 221, o({ strokeWidth: 2.2 }));
    rc.line(BELT_X1 + 6, y1 + 7, BELT_X1 + 11, 221, o({ strokeWidth: 2.2 }));
    rc.line(BELT_X0 - 14, y1 + 7, BELT_X0 - 18, y0 + 2, o({ strokeWidth: 1.8 }));
  }

  function drawRail(o: (e?: Rough) => Rough): void {
    // Upright post from the front of the deck up to the console, and the handrail.
    rc.line(BELT_X1 + 14, BELT_Y + 21, LCD.x + 18, LCD.y + LCD.h + 10, o({ strokeWidth: 2.6 }));
    rc.line(BELT_X1 + 4, BELT_Y + 18, LCD.x + 8, LCD.y + LCD.h + 10, o({ strokeWidth: 1.6 }));
    rc.linearPath(
      [
        [LCD.x + 10, LCD.y + LCD.h + 22],
        [294, 126],
        [288, 133],
      ],
      o({ strokeWidth: 2.4 }),
    );
  }

  function drawFigure(sk: Skeleton, o: (e?: Rough) => Rough, layer: number, tie: readonly Point[], accent: string): void {
    const limb = (a: Point, b: Point, c: Point, w: number): void =>
      void rc.linearPath([pt(a), pt(b), pt(c)], o({ strokeWidth: w }));
    if (layer < 1) {
      ctx.globalAlpha = layer;
      limb(sk.hip, sk.kneeFar, sk.footFar, 2);
      limb(sk.shoulder, sk.elbowFar, sk.handFar, 2);
      ctx.globalAlpha = 1;
      return;
    }
    rc.line(sk.neck[0], sk.neck[1], sk.hip[0], sk.hip[1], o({ strokeWidth: 2.3 }));
    drawTie(tie, o, accent);
    limb(sk.hip, sk.kneeNear, sk.footNear, 2.3);
    limb(sk.shoulder, sk.elbowNear, sk.handNear, 2.2);
    // Head: drawn over the body with the page colour behind, like a solid shape.
    ctx.fillStyle = getComputedStyle(canvas).getPropertyValue("--ground").trim() || "#9b9b98";
    ctx.beginPath();
    ctx.arc(sk.head[0], sk.head[1], HEAD_R - 1, 0, Math.PI * 2);
    ctx.fill();
    rc.circle(sk.head[0], sk.head[1], HEAD_R * 2, o({ strokeWidth: 2.2 }));
  }

  /**
   * The tie, drawn through the chain points: a tapered blade that widens towards
   * a pointed tip, and a small knot. Orange fill, pencil outline.
   */
  function drawTie(pts: readonly Point[], o: (e?: Rough) => Rough, accent: string): void {
    const n = pts.length;
    if (n < 2) return;
    const at = (i: number): Point => pts[Math.min(n - 1, Math.max(0, i))] ?? [0, 0];
    const unit = (a: Point, b: Point): Point => {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const d = Math.hypot(dx, dy) || 1;
      return [dx / d, dy / d];
    };
    const left: [number, number][] = [];
    const right: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const d = unit(at(i - 1), at(i + 1));
      const half = 1.4 + (3.2 * i) / (n - 1); // narrow at the knot, wide at the bottom
      const p = at(i);
      left.push([p[0] - d[1] * half, p[1] + d[0] * half]);
      right.push([p[0] + d[1] * half, p[1] - d[0] * half]);
    }
    const end = unit(at(n - 2), at(n - 1));
    const last = at(n - 1);
    const tip: [number, number] = [last[0] + end[0] * 5, last[1] + end[1] * 5];
    const fill = (extra: Rough = {}): Rough =>
      o({ fill: accent, fillStyle: "solid", strokeWidth: 1.1, roughness: 0.7, bowing: 0.4, ...extra });
    rc.polygon([...left, tip, ...right.reverse()], fill());

    // Knot: a little diamond at the collar.
    const k = at(0);
    const d = unit(k, at(1));
    rc.polygon(
      [
        [k[0] - d[0] * 3, k[1] - d[1] * 3],
        [k[0] - d[1] * 2.8, k[1] + d[0] * 2.8],
        [k[0] + d[0] * 2.6, k[1] + d[1] * 2.6],
        [k[0] + d[1] * 2.8, k[1] - d[0] * 2.8],
      ],
      fill({ roughness: 0.4 }),
    );
  }

  function drawFace(now: number, input: RunnerInput, sk: Skeleton, o: (e?: Rough) => Rough): void {
    const [hx, cy] = sk.head;
    const cx = hx + 3; // looking a little forward, the way it runs
    const fine = (extra: Rough = {}): Rough => o({ roughness: 0.6, bowing: 0.5, strokeWidth: 1.8, ...extra });
    const dot = (x: number, y: number, d: number): void =>
      void rc.circle(x, y, d, fine({ fill: o().stroke ?? "#121212", fillStyle: "solid", roughness: 0.3 }));
    const eyeY = cy - 4;
    const eyes = [cx - 7.5, cx + 7.5] as const;
    const my = cy + 8;
    const stumbling = now < s.stumbleUntil;
    const big = now < s.bigUntil;
    const gait = gaitFor(s.speed);
    const blink = now < s.blinkUntil;

    // From the moment time is up: tired (or delighted), even while the belt winds down.
    if (s.endSince || input.phase === "finished") {
      if (input.newBest) {
        // Happy closed eyes and a big grin (hangman's win face).
        for (const ex of eyes) rc.arc(ex, eyeY + 1.5, 7, 6, Math.PI, Math.PI * 2, false, fine());
        rc.arc(cx, my - 2, 16, 10, Math.PI * 0.1, Math.PI * 0.9, false, fine());
      } else {
        // Exhausted: squeezed eyes, open mouth gasping.
        for (const ex of eyes) rc.line(ex - 3, eyeY, ex + 3, eyeY + (ex < cx ? -1 : 1) * 0.5, fine());
        rc.line(cx - 12, eyeY - 6, cx - 4, eyeY - 8, fine({ strokeWidth: 1.4 }));
        rc.line(cx + 4, eyeY - 8, cx + 12, eyeY - 6, fine({ strokeWidth: 1.4 }));
        const gasp = reduce || !s.endSince ? 0 : Math.floor((now - s.endSince) / 230) % 2;
        rc.ellipse(cx, my + 1.5, 8, gasp ? 10 : 6, fine({ strokeWidth: 1.6 }));
      }
      return;
    }

    if (stumbling || big) {
      // Wide eyes. A run of typos: panicked, with raised brows and a wobbly mouth.
      const jig = big && !reduce ? [rand(-0.8, 0.8), rand(-0.8, 0.8)] : [0, 0];
      for (const ex of eyes) {
        rc.circle(ex, eyeY, big ? 11 : 9.5, fine({ strokeWidth: 1.4 }));
        dot(ex + (jig[0] ?? 0), eyeY + (jig[1] ?? 0), 2.6);
      }
      if (big) {
        rc.line(cx - 12, eyeY - 9, cx - 4, eyeY - 12, fine({ strokeWidth: 1.5 }));
        rc.line(cx + 4, eyeY - 12, cx + 12, eyeY - 9, fine({ strokeWidth: 1.5 }));
        const pts: [number, number][] = [];
        for (let i = 0; i <= 6; i++) pts.push([cx - 7 + (i * 14) / 6, my + 2 + (i % 2 ? -1.8 : 1.8)]);
        rc.linearPath(pts, fine({ strokeWidth: 1.5, roughness: 0.4 }));
      } else {
        rc.ellipse(cx, my + 1, 6, 7, fine({ strokeWidth: 1.5 }));
      }
      return;
    }

    if (gait === "stand") {
      // Waiting: calm dots, blinking, small smile.
      for (const ex of eyes) {
        if (blink) rc.line(ex - 2.5, eyeY, ex + 2.5, eyeY, fine());
        else dot(ex, eyeY, 3.6);
      }
      rc.arc(cx, my - 3, 12, 7, Math.PI * 0.15, Math.PI * 0.85, false, fine());
      return;
    }

    // Moving: relaxed while walking, focused brows from a jog, fiercer with speed.
    const fierce = s.speed >= 70;
    for (const ex of eyes) {
      if (blink && !fierce) rc.line(ex - 2.5, eyeY, ex + 2.5, eyeY, fine());
      else dot(ex, eyeY + (fierce ? 0.5 : 0), fierce ? 3.2 : 3.4);
    }
    if (gait === "walk") {
      rc.arc(cx, my - 2, 9, 4, Math.PI * 0.15, Math.PI * 0.85, false, fine());
      return;
    }
    const tilt = fierce ? 3 : 1.6;
    rc.line(cx - 12, eyeY - 8 - tilt, cx - 3, eyeY - 7, fine({ strokeWidth: 1.6 }));
    rc.line(cx + 3, eyeY - 7, cx + 12, eyeY - 8 - tilt, fine({ strokeWidth: 1.6 }));

    if (fierce) {
      // Gritted teeth.
      rc.rectangle(cx - 7, my - 2.5, 14, 6, fine({ strokeWidth: 1.5, roughness: 0.4 }));
      rc.line(cx - 7, my + 0.5, cx + 7, my + 0.5, fine({ strokeWidth: 1, roughness: 0.3 }));
      for (const tx of [cx - 3.5, cx, cx + 3.5]) rc.line(tx, my - 2.5, tx, my + 3.5, fine({ strokeWidth: 1, roughness: 0.3 }));
    } else {
      rc.line(cx - 4.5, my, cx + 4.5, my, fine());
    }

    // Sprinting: a sweatband with its tails flapping behind.
    if (gait === "sprint") {
      // Pencil, not orange: the tie is the only coloured thing on him.
      const band = (extra: Rough = {}): Rough => o({ strokeWidth: 3, roughness: 0.7, bowing: 0.6, ...extra });
      rc.arc(hx, cy + 2, HEAD_R * 2 + 1, HEAD_R * 2 - 6, Math.PI * 1.08, Math.PI * 1.92, false, band());
      const flap = reduce ? 0 : (Math.floor(now / 80) % 2) * 4 - 2;
      const bx = hx - HEAD_R + 1;
      const by = cy - 8;
      rc.line(bx, by, bx - 14, by - 2 + flap, band({ strokeWidth: 2.2 }));
      rc.line(bx, by + 1, bx - 12, by + 5 - flap, band({ strokeWidth: 2.2 }));
    }
  }

  function drawSpeedLines(sk: Skeleton, o: (e?: Rough) => Rough): void {
    if (s.speed < 88 || s.endSince) return;
    const k = clamp01((s.speed - 88) / 12);
    ctx.globalAlpha = 0.35 + 0.4 * k;
    const x0 = sk.hip[0] - 44;
    const rows = [sk.shoulder[1] + 4, sk.hip[1] - 12, sk.kneeNear[1] + 4];
    rows.forEach((y, i) => {
      const len = 24 + 14 * k + (reduce ? 0 : rand(-5, 5));
      const start = x0 - i * 6 - (reduce ? 0 : rand(0, 6));
      rc.line(start, y, start - len, y + rand(-1, 1), o({ strokeWidth: 1.6, roughness: 1.2 }));
    });
    ctx.globalAlpha = 1;
  }

  function drawEffects(now: number, sk: Skeleton, o: (e?: Rough) => Rough, accent: string): void {
    const [hx, cy] = sk.head;
    const fine = (extra: Rough = {}): Rough => o({ roughness: 0.4, bowing: 0.3, strokeWidth: 1.2, ...extra });

    // Sweat drops flying off the head.
    const drops: Drop[] = reduce
      ? s.speed >= 80 || (s.endSince && !source().newBest)
        ? [
            { x: -(HEAD_R + 4), y: -2, vx: 0, vy: 0, born: now },
            { x: HEAD_R + 4, y: 4, vx: 0, vy: 0, born: now },
          ]
        : []
      : s.drops;
    for (const d of drops) {
      const x = hx + d.x;
      const y = cy + d.y;
      const path = `M ${x} ${y - 5} C ${x + 3.5} ${y - 1}, ${x + 3} ${y + 2.5}, ${x} ${y + 2.5} C ${x - 3} ${y + 2.5}, ${x - 3.5} ${y - 1}, ${x} ${y - 5} Z`;
      rc.path(path, fine({ fill: o().stroke ?? "#121212", fillStyle: "solid", roughness: 0.3 }));
    }

    // Dust puffs at the feet, drifting back with the belt.
    if (!reduce) {
      s.puffs = s.puffs.filter((p) => now - p.born < 450);
      for (const p of s.puffs) {
        const u = (now - p.born) / 450;
        ctx.globalAlpha = 0.55 * (1 - u);
        const drift = u * (30 + motionFor(s.speed).beltSpeed * 0.3);
        rc.circle(p.x - drift, p.y - u * 6, p.size * (0.5 + u), o({ strokeWidth: 1.2, roughness: 1.4 }));
      }
      ctx.globalAlpha = 1;
    }

    // A scribbly "!" (or "!!" for a big stumble).
    if (now < s.stumbleUntil || now < s.bigUntil) {
      const count = now < s.bigUntil ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const x = hx + HEAD_R + 8 + i * 9;
        const y = cy - HEAD_R - 6 - i * 2;
        rc.line(x, y - 14, x + 1.5, y + 2, o({ stroke: accent, strokeWidth: 2.8, roughness: 0.8 }));
        rc.circle(x + 2, y + 8, 3.2, o({ stroke: accent, fill: accent, fillStyle: "solid", strokeWidth: 1, roughness: 0.3 }));
      }
    }
  }

  function drawConsole(input: RunnerInput, o: (e?: Rough) => Rough, c: ReturnType<typeof colors>): void {
    const { x, y, w, h } = LCD;
    // Housing.
    rc.rectangle(x - 7, y - 7, w + 14, h + 18, o({ strokeWidth: 2.2 }));
    // Screen.
    ctx.fillStyle = c.lcdBg;
    ctx.fillRect(x, y, w, h);
    rc.rectangle(x, y, w, h, o({ strokeWidth: 1.3, roughness: 0.6 }));

    const wpmText = String(Math.min(999, Math.max(0, Math.round(input.consoleWpm))));
    const secText = String(Math.max(0, Math.ceil(input.remainingSeconds)));
    const lcd = (extra: Rough = {}): Rough => o({ stroke: c.lcdInk, strokeWidth: 2.2, roughness: 0.35, bowing: 0.2, ...extra });
    sevenSeg(wpmText.padStart(3, " "), x + 6, y + 6, 9, 17, lcd);
    sevenSeg(secText.padStart(2, " "), x + 52, y + 6, 9, 17, lcd);
    ctx.globalAlpha = 0.5;
    rc.line(x + 46, y + 6, x + 46, y + 30, lcd({ strokeWidth: 1, roughness: 0.4 }));
    ctx.globalAlpha = 1;

    ctx.fillStyle = c.lcdInk;
    ctx.font = "500 7px 'Geist Mono', ui-monospace, monospace";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("wpm", x + 6, y + h - 2.5);
    ctx.fillText("sec", x + 52, y + h - 2.5);

    // Power light and two buttons under the screen.
    const on = input.phase === "running";
    rc.circle(x + 4, y + h + 6, 4, o({ stroke: on ? c.accent : c.ink, fill: on ? c.accent : "transparent", fillStyle: "solid", strokeWidth: 1, roughness: 0.4 }));
    rc.line(x + w - 26, y + h + 6, x + w - 18, y + h + 6, o({ strokeWidth: 1.6, roughness: 0.6 }));
    rc.line(x + w - 12, y + h + 6, x + w - 4, y + h + 6, o({ strokeWidth: 1.6, roughness: 0.6 }));
  }

  /** Seven-segment digits, unlit segments faintly visible like a real LCD. */
  function sevenSeg(text: string, x0: number, y0: number, dw: number, dh: number, lcd: (e?: Rough) => Rough): void {
    const half = dh / 2;
    [...text].forEach((ch, i) => {
      const x = x0 + i * (dw + 4.5);
      const segs: Record<string, [number, number, number, number]> = {
        a: [x + 1, y0, x + dw - 1, y0],
        b: [x + dw, y0 + 1, x + dw, y0 + half - 1],
        c: [x + dw, y0 + half + 1, x + dw, y0 + dh - 1],
        d: [x + 1, y0 + dh, x + dw - 1, y0 + dh],
        e: [x, y0 + half + 1, x, y0 + dh - 1],
        f: [x, y0 + 1, x, y0 + half - 1],
        g: [x + 1, y0 + half, x + dw - 1, y0 + half],
      };
      const lit = SEGMENTS[ch] ?? "";
      for (const [name, [ax, ay, bx, by]] of Object.entries(segs)) {
        const on = lit.includes(name);
        ctx.globalAlpha = on ? 1 : 0.1;
        rc.line(ax, ay, bx, by, lcd());
      }
      ctx.globalAlpha = 1;
    });
  }

  // --- loop ---------------------------------------------------------------
  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    const input = source();
    const dt = Math.min(0.1, Math.max(0, (now - lastStep) / 1000));
    lastStep = now;
    step(dt, now, input);

    // Redraw on the boil beat, or sooner when the run cycle steps to its next
    // keyframe (fast runners step more than 10 times a second) or during a stumble.
    const frameIdx = Math.floor(s.phase) % FRAMES;
    const interval = isBusy(now) && !reduce ? FAST_MS : BOIL_MS;
    const stepped = frameIdx !== lastFrameIdx && s.speed > 0 && !reduce;
    if (now - lastDraw < interval && !(stepped && now - lastDraw > 40)) return;
    lastFrameIdx = frameIdx;
    lastDraw = now;
    draw(now);
  }

  const onMotionChange = (): void => {
    reduce = prefersReducedMotion();
    s.trip = atRest();
    s.puffs = [];
    s.drops = [];
    draw(performance.now());
  };
  motionQuery?.addEventListener("change", onMotionChange);

  resize();
  raf = requestAnimationFrame(frame);

  return {
    stumble,
    reset,
    redraw: () => draw(performance.now()),
    destroy() {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      motionQuery?.removeEventListener("change", onMotionChange);
    },
  };
}

const SEGMENTS: Record<string, string> = {
  "0": "abcdef",
  "1": "bc",
  "2": "abged",
  "3": "abgcd",
  "4": "fgbc",
  "5": "afgcd",
  "6": "afgedc",
  "7": "abc",
  "8": "abcdefg",
  "9": "abcdfg",
  " ": "",
};

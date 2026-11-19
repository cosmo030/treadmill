// Cuts a recording of someone typing into single keystrokes for the typing sound.
//
//   node scripts/slice-keys.mjs <recording.wav> [credit text]
//
// Needs ffmpeg. Finds every transient, cuts each keystroke until the next one
// starts (keeping the key's own quiet release click), keeps only clean single
// hits (first hit loudest, nothing clipped), picks 8 typical keys and the 5
// deepest, loudest hits as the space bar, levels them, and writes
//   public/sounds/keys.wav   all slices back to back (WAV, because MP3 would add
//                            a few ms of silence at the start of every key)
//   src/keySprite.ts         where each slice starts and how long it is
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [source, credit = ""] = process.argv.slice(2);
if (!source) {
  console.error("usage: node scripts/slice-keys.mjs <recording.wav> [credit]");
  process.exit(1);
}
const ROOT = path.resolve(import.meta.dirname, "..");
const SR = 44100;
const tmpIn = path.join(os.tmpdir(), `slice-keys-in-${process.pid}.f32`);
const tmpOut = path.join(os.tmpdir(), `slice-keys-out-${process.pid}.f32`);

execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", source, "-f", "f32le", "-ac", "1", "-ar", String(SR), tmpIn]);
const b = fs.readFileSync(tmpIn);
fs.unlinkSync(tmpIn);
const x = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);

// 1 ms peak envelope.
const W = Math.round(SR * 0.001);
const env = [];
for (let i = 0; i < x.length; i += W) {
  let m = 0;
  for (let j = i; j < Math.min(x.length, i + W); j++) m = Math.max(m, Math.abs(x[j]));
  env.push(m);
}

// Transients: the envelope jumps to 3× what it was 3 ms earlier, above the noise.
const NOISE = 0.03;
const onsets = [];
for (let f = 3; f < env.length; f++) {
  if (env[f] > NOISE && env[f] > 3 * Math.max(env[f - 3], 0.003) && (!onsets.length || f - onsets.at(-1) > 15)) onsets.push(f);
}

const peakNear = (f) => {
  let p = 0;
  for (let g = f; g < f + 6 && g < env.length; g++) p = Math.max(p, env[g]);
  return p;
};

const hits = [];
for (let k = 0; k < onsets.length; k++) {
  const f = onsets[k];
  const p0 = peakNear(f);
  // End: allow one quiet follow-up click (the key's own release, 40+ ms later),
  // and cut just before anything else that rises above 12% of the hit.
  let end = Math.min(env.length, f + 160);
  let releases = 0;
  for (let j = k + 1; j < onsets.length && onsets[j] < end; j++) {
    const r = peakNear(onsets[j]) / p0;
    if (r <= 0.12) continue;
    if (releases === 0 && r <= 0.45 && onsets[j] - f >= 40) {
      releases++;
      continue;
    }
    end = onsets[j] - 3;
    break;
  }
  // Loudest sample, clipping, and how much low "thock" is in the first 60 ms.
  let peakAll = 0;
  let clipped = 0;
  let lowE = 0;
  let allE = 0;
  let lp = 0;
  const a = Math.exp((-2 * Math.PI * 350) / SR);
  for (let s = f * W; s < end * W; s++) {
    peakAll = Math.max(peakAll, Math.abs(x[s]));
    if (Math.abs(x[s]) >= 0.999) clipped++;
    if (s < f * W + 0.06 * SR) {
      lp = (1 - a) * x[s] + a * lp;
      lowE += lp * lp;
      allE += x[s] * x[s];
    }
  }
  hits.push({ t: +(f / 1000).toFixed(3), f, end, len: end - f, p0, peakAll, clipped, low: lowE / (allE || 1) });
}

const clean = hits.filter((h) => h.clipped === 0 && h.p0 >= 0.35 && h.p0 < 0.995 && h.peakAll <= h.p0 * 1.05 && h.len >= 80);
const space = clean
  .filter((h) => h.p0 >= 0.6 && h.len >= 110)
  .sort((p, q) => q.low - p.low)
  .slice(0, 5);
const spaceAt = new Set(space.map((h) => h.f));
const keys = clean
  .filter((h) => !spaceAt.has(h.f) && h.low >= 0.04 && h.low <= 0.11)
  .sort((p, q) => Math.abs(p.p0 - 0.7) - Math.abs(q.p0 - 0.7))
  .slice(0, 8)
  .sort((p, q) => p.f - q.f);
console.log(`transients ${hits.length}, clean single hits ${clean.length}, using ${keys.length} keys + ${space.length} spaces`);

// Cut, level (RMS of the first 80 ms), fade in 1 ms and out 30 ms.
const PRE = Math.round(0.0015 * SR);
const GAP = Math.round(0.02 * SR);
function cut(h, targetRms) {
  const s = Math.max(0, h.f * W - PRE);
  const seg = Float32Array.from(x.subarray(s, h.end * W));
  const m = Math.min(seg.length, Math.round(0.08 * SR));
  let e = 0;
  for (let i = 0; i < m; i++) e += seg[i] * seg[i];
  let peak = 0;
  for (const v of seg) peak = Math.max(peak, Math.abs(v));
  const gain = Math.min(targetRms / (Math.sqrt(e / m) || 1), 0.95 / peak);
  const fi = Math.round(0.001 * SR);
  const fo = Math.round(0.03 * SR);
  for (let i = 0; i < seg.length; i++) {
    let g = gain;
    if (i < fi) g *= i / fi;
    if (i > seg.length - fo) g *= (seg.length - i) / fo;
    seg[i] *= g;
  }
  return seg;
}

const parts = [];
const sliceList = { key: [], space: [] };
const sources = [];
let pos = GAP;
const add = (list, h, target) => {
  const seg = cut(h, target);
  parts.push({ at: pos, seg });
  sliceList[list].push([+(pos / SR).toFixed(5), +(seg.length / SR).toFixed(5)]);
  sources.push(`${list} ${h.t}s`);
  pos += seg.length + GAP;
};
keys.forEach((h) => add("key", h, 0.09));
space.forEach((h) => add("space", h, 0.12));

const out = new Float32Array(pos);
for (const { at, seg } of parts) out.set(seg, at);
fs.writeFileSync(tmpOut, Buffer.from(out.buffer));
fs.mkdirSync(path.join(ROOT, "public/sounds"), { recursive: true });
execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "f32le", "-ar", String(SR), "-ac", "1", "-i", tmpOut, "-c:a", "pcm_s16le", path.join(ROOT, "public/sounds/keys.wav")]);
fs.unlinkSync(tmpOut);

const list = (slices) => slices.map(([s, d]) => `    [${s}, ${d}],`).join("\n");
fs.writeFileSync(
  path.join(ROOT, "src/keySprite.ts"),
  `// Generated by scripts/slice-keys.mjs. Don't edit by hand.
${credit ? `// Recording: ${credit}\n` : ""}// Slices of public/sounds/keys.wav as [start, duration] in seconds.
// Taken from (seconds into the recording): ${sources.join(", ")}

export type Slice = readonly [start: number, duration: number];

export const KEY_SPRITE = {
  url: "/sounds/keys.wav",
  /** Letter keys. */
  key: [
${list(sliceList.key)}
  ] as readonly Slice[],
  /** The space bar: the deepest, loudest clean hits in the recording. */
  space: [
${list(sliceList.space)}
  ] as readonly Slice[],
  /** Total length of the file, seconds. */
  length: ${+(pos / SR).toFixed(5)},
};
`,
);
console.log(`wrote public/sounds/keys.wav (${(pos / SR).toFixed(2)} s) and src/keySprite.ts`);

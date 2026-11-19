import { describe, expect, it } from "vitest";
import { Game, ROUND_MS } from "../src/game.ts";
import { keys, seeded } from "./helpers.ts";

function play(g: Game, text: string, t0: number, gap = 100): number {
  let t = t0;
  for (const k of keys(text)) {
    g.press(k, t);
    t += gap;
  }
  return t;
}

describe("game states", () => {
  it("starts ready with a full 30 seconds", () => {
    const g = new Game(seeded(1));
    expect(g.state.phase).toBe("ready");
    expect(g.remainingMs(12345)).toBe(ROUND_MS);
    expect(g.tick(99999)).toBe(false);
    expect(g.state.phase).toBe("ready");
  });

  it("starts the clock on the first keystroke", () => {
    const g = new Game(seeded(1));
    g.press({ kind: "char", char: "x" }, 5000);
    expect(g.state).toEqual({ phase: "running", startedAt: 5000 });
    expect(g.remainingMs(15_000)).toBe(20_000);
  });

  it("doesn't start on space or backspace", () => {
    const g = new Game(seeded(1));
    expect(g.press({ kind: "space" }, 0)).toBe("ignored");
    expect(g.press({ kind: "backspace" }, 0)).toBe("ignored");
    expect(g.state.phase).toBe("ready");
  });

  it("finishes after 30 seconds and locks input", () => {
    const g = new Game(seeded(1));
    const first = g.session.target;
    play(g, first + " ", 1000);
    expect(g.tick(1000 + ROUND_MS - 1)).toBe(false);
    expect(g.tick(1000 + ROUND_MS)).toBe(true);
    const s = g.state;
    expect(s.phase).toBe("finished");
    if (s.phase !== "finished") return;
    expect(s.endedAt - s.startedAt).toBe(ROUND_MS);
    expect(s.stats.wpm).toBe(Math.round((first.length + 1) / 5 / 0.5));
    // Locked.
    const before = g.session.totalKeystrokes;
    expect(g.press({ kind: "char", char: "a" }, 40_000)).toBe("ignored");
    expect(g.session.totalKeystrokes).toBe(before);
    expect(g.tick(50_000)).toBe(false);
  });

  it("ignores a key that arrives after time ran out, even before the tick", () => {
    const g = new Game(seeded(1));
    g.press({ kind: "char", char: "x" }, 0);
    expect(g.press({ kind: "char", char: "y" }, ROUND_MS + 5)).toBe("ignored");
    expect(g.state.phase).toBe("finished");
    expect(g.session.totalKeystrokes).toBe(1);
  });

  it("keeps the live WPM smoothed and rising while typing steadily", () => {
    const g = new Game(seeded(2));
    let t = 0;
    const seen: number[] = [];
    for (let i = 0; i < 40; i++) {
      t = play(g, g.session.target + " ", t, 120);
      g.tick(t);
      seen.push(g.liveWpm);
    }
    // 120 ms per key = 100 WPM. Smoothed value climbs towards it without overshooting.
    expect(seen.at(-1)).toBeGreaterThan(80);
    expect(Math.max(...seen)).toBeLessThan(110);
  });
});

describe("restart", () => {
  it("goes back to ready with fresh words from any state", () => {
    const g = new Game(seeded(9));
    const firstWords = g.session.words.slice(0, 10).join(" ");
    play(g, "abc def", 0);
    g.restart();
    expect(g.state.phase).toBe("ready");
    expect(g.session.index).toBe(0);
    expect(g.session.totalKeystrokes).toBe(0);
    expect(g.session.stumbles).toBe(0);
    expect(g.liveWpm).toBe(0);
    expect(g.session.words.slice(0, 10).join(" ")).not.toBe(firstWords);

    // From finished too, and the next round starts on a key again.
    g.press({ kind: "char", char: "a" }, 0);
    g.tick(ROUND_MS);
    expect(g.state.phase).toBe("finished");
    g.restart();
    expect(g.state.phase).toBe("ready");
    g.press({ kind: "char", char: "a" }, 100_000);
    expect(g.state).toEqual({ phase: "running", startedAt: 100_000 });
  });
});

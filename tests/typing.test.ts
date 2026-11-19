import { describe, expect, it } from "vitest";
import {
  accuracy,
  computeStats,
  correctChars,
  letterStates,
  LOOKAHEAD,
  MAX_EXTRA,
  rollingWpm,
  smoothTowards,
  TypingSession,
  wpm,
} from "../src/typing.ts";
import { keys, seeded } from "./helpers.ts";

/** A session whose first words are known. */
function sessionWith(words: string[]): TypingSession {
  const s = new TypingSession(seeded(1));
  s.words.splice(0, words.length, ...words);
  return s;
}

function type(s: TypingSession, text: string, t0 = 0, gap = 100): void {
  keys(text).forEach((k, i) => s.press(k, t0 + i * gap));
}

describe("WPM", () => {
  it("is correct characters ÷ 5 ÷ minutes, rounded", () => {
    expect(wpm(100, 30_000)).toBe(40);
    expect(wpm(62 * 2.5, 30_000)).toBe(62);
    expect(wpm(33, 30_000)).toBe(13); // 13.2
    expect(wpm(34, 30_000)).toBe(14); // 13.6
    expect(wpm(50, 60_000)).toBe(10);
  });

  it("is 0 with no time or no characters", () => {
    expect(wpm(0, 30_000)).toBe(0);
    expect(wpm(10, 0)).toBe(0);
  });

  it("counts correct completed words plus their spaces, skips wrong ones", () => {
    const s = sessionWith(["the", "quick", "fox", "jumps"]);
    type(s, "the quikc fox ");
    // "the " (4) + "fox " (4) = 8; "quikc" is wrong and adds nothing.
    expect(correctChars(s.words, s.typed, s.index, false)).toBe(8);
  });

  it("counts a fully typed last word when time runs out, without a space", () => {
    const s = sessionWith(["the", "quick", "fox"]);
    type(s, "the quick");
    expect(correctChars(s.words, s.typed, s.index, false)).toBe(4);
    expect(correctChars(s.words, s.typed, s.index, true)).toBe(9);
    // A half-typed last word never counts.
    const t = sessionWith(["the", "quick"]);
    type(t, "the qui");
    expect(correctChars(t.words, t.typed, t.index, true)).toBe(4);
  });

  it("matches a manual calculation for a whole round", () => {
    // 10 × "the " = 40 characters in 30 s → 40 / 5 / 0.5 = 16 WPM.
    const s = sessionWith(Array(12).fill("the"));
    type(s, "the ".repeat(10));
    expect(computeStats(s, 30_000, true).wpm).toBe(16);
  });

  it("counts a word fixed with backspace as correct", () => {
    const s = sessionWith(["cat", "dog"]);
    type(s, "cst<<at ");
    expect(correctChars(s.words, s.typed, s.index, false)).toBe(4);
  });
});

describe("accuracy", () => {
  it("is correct keystrokes ÷ all keystrokes, as a percentage", () => {
    expect(accuracy(97, 100)).toBe(97);
    expect(accuracy(1, 3)).toBe(33);
    expect(accuracy(0, 0)).toBe(100);
  });

  it("rounds down so one mistake is never 100%", () => {
    expect(accuracy(999, 1000)).toBe(99);
  });

  it("counts letters and spaces as keystrokes, not backspaces", () => {
    const s = sessionWith(["cat", "dog"]);
    type(s, "cxt<<at ");
    // "cxt": c ✓ x ✗ t ✓, two backspaces (not counted), "at" ✓✓, space ✓ → 6 keystrokes, 5 correct.
    expect(s.totalKeystrokes).toBe(6);
    expect(s.correctKeystrokes).toBe(5);
    expect(computeStats(s, 30_000, true).accuracy).toBe(83);
  });

  it("counts a space after a wrong word as a wrong keystroke", () => {
    const s = sessionWith(["cat", "dog"]);
    type(s, "ca ");
    expect(s.totalKeystrokes).toBe(3);
    expect(s.correctKeystrokes).toBe(2);
  });
});

describe("stumbles", () => {
  it("counts every wrong letter keystroke, not wrong words", () => {
    const s = sessionWith(["cat", "dog", "sun"]);
    type(s, "cxx<<at dgo sun");
    // x, x, then "dgo": g and o are wrong → 4.
    expect(s.stumbles).toBe(4);
  });

  it("counts extra letters past the end of the word", () => {
    const s = sessionWith(["cat"]);
    type(s, "catss");
    expect(s.stumbles).toBe(2);
    expect(letterStates("cat", s.current).map((l) => l.state)).toEqual([
      "correct",
      "correct",
      "correct",
      "extra",
      "extra",
    ]);
  });

  it("doesn't take a stumble back on backspace", () => {
    const s = sessionWith(["cat"]);
    type(s, "x<");
    expect(s.stumbles).toBe(1);
    expect(s.current).toBe("");
  });

  it("caps extra letters", () => {
    const s = sessionWith(["a"]);
    type(s, "a" + "z".repeat(50));
    expect(s.current.length).toBe(1 + MAX_EXTRA);
    expect(s.stumbles).toBe(MAX_EXTRA);
  });

  it("is case sensitive: the words are lowercase", () => {
    const s = sessionWith(["cat"]);
    s.press({ kind: "char", char: "C" }, 0);
    expect(s.stumbles).toBe(1);
  });
});

describe("backspace", () => {
  it("works inside the current word", () => {
    const s = sessionWith(["cat", "dog"]);
    type(s, "ca<");
    expect(s.current).toBe("c");
    expect(s.press({ kind: "backspace" }, 0)).toBe("deleted");
    expect(s.current).toBe("");
  });

  it("never goes back into the previous word", () => {
    const s = sessionWith(["cat", "dog"]);
    type(s, "cat ");
    expect(s.index).toBe(1);
    expect(s.press({ kind: "backspace" }, 0)).toBe("ignored");
    expect(s.index).toBe(1);
    expect(s.typed[0]).toBe("cat");
  });

  it("clear-word (ctrl/alt+backspace) empties only the current word", () => {
    const s = sessionWith(["cat", "dog"]);
    type(s, "cat do");
    expect(s.press({ kind: "clearWord" }, 0)).toBe("deleted");
    expect(s.current).toBe("");
    expect(s.typed[0]).toBe("cat");
    expect(s.press({ kind: "clearWord" }, 0)).toBe("ignored");
  });
});

describe("word advancing", () => {
  it("moves to the next word on space", () => {
    const s = sessionWith(["cat", "dog"]);
    type(s, "cat");
    expect(s.press({ kind: "space" }, 0)).toBe("advanced");
    expect(s.index).toBe(1);
    expect(s.target).toBe("dog");
    expect(s.current).toBe("");
  });

  it("ignores space when nothing has been typed in the word", () => {
    const s = sessionWith(["cat", "dog"]);
    expect(s.press({ kind: "space" }, 0)).toBe("ignored");
    type(s, "cat  ");
    expect(s.index).toBe(1);
    expect(s.totalKeystrokes).toBe(4);
  });

  it("advances past a wrong or unfinished word", () => {
    const s = sessionWith(["cat", "dog"]);
    type(s, "c ");
    expect(s.index).toBe(1);
    expect(letterStates("cat", s.typed[0] ?? "").map((l) => l.state)).toEqual(["correct", "untyped", "untyped"]);
  });

  it("always keeps enough words ahead", () => {
    const s = new TypingSession(seeded(5));
    for (let i = 0; i < 300; i++) {
      type(s, s.target + " ");
      expect(s.words.length - s.index).toBeGreaterThanOrEqual(LOOKAHEAD);
    }
    for (let i = 1; i < s.words.length; i++) expect(s.words[i]).not.toBe(s.words[i - 1]);
  });
});

describe("letterStates", () => {
  it("marks correct, wrong and untyped letters", () => {
    expect(letterStates("fox", "fa")).toEqual([
      { char: "f", state: "correct" },
      { char: "o", state: "wrong" },
      { char: "x", state: "untyped" },
    ]);
  });
});

describe("live WPM", () => {
  it("counts correct keystrokes in the last 3 seconds", () => {
    // 25 hits in the last 3 s → 25 / 5 / (3/60) = 100 WPM.
    const hits = Array.from({ length: 25 }, (_, i) => 7050 + i * 100);
    expect(rollingWpm(hits, 10_000, 0)).toBeCloseTo(100);
  });

  it("ignores hits older than the window", () => {
    const hits = [0, 100, 200, 9500];
    expect(rollingWpm(hits, 10_000, 0)).toBeCloseTo(1 / 5 / (3 / 60));
  });

  it("uses a shorter window early on, but at least a second", () => {
    expect(rollingWpm([0, 100, 200, 300, 400], 500, 0)).toBeCloseTo(5 / 5 / (1 / 60));
    expect(rollingWpm([100, 1000, 1500], 2000, 0)).toBeCloseTo(3 / 5 / (2 / 60));
  });

  it("is smoothed towards the target without jumping", () => {
    let v = 0;
    v = smoothTowards(v, 100, 16);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(5);
    for (let i = 0; i < 300; i++) v = smoothTowards(v, 100, 16);
    expect(v).toBeCloseTo(100, 0);
    // Frame-rate independent: one 100 ms step ≈ ten 10 ms steps.
    let a = 0;
    for (let i = 0; i < 10; i++) a = smoothTowards(a, 50, 10);
    expect(a).toBeCloseTo(smoothTowards(0, 50, 100), 6);
  });
});

import { describe, expect, it } from "vitest";
import { randomWords, WORDS } from "../src/words.ts";
import { seeded } from "./helpers.ts";

describe("word list", () => {
  it("has about 300 short, lowercase a–z words without duplicates", () => {
    expect(WORDS.length).toBeGreaterThanOrEqual(280);
    expect(WORDS.length).toBeLessThanOrEqual(320);
    expect(new Set(WORDS).size).toBe(WORDS.length);
    for (const w of WORDS) expect(w).toMatch(/^[a-z]{1,8}$/);
    const short = WORDS.filter((w) => w.length >= 2 && w.length <= 7).length;
    expect(short / WORDS.length).toBeGreaterThan(0.9);
  });
});

describe("randomWords", () => {
  it("never repeats a word twice in a row", () => {
    const words = randomWords(5000, seeded(7));
    for (let i = 1; i < words.length; i++) expect(words[i]).not.toBe(words[i - 1]);
  });

  it("doesn't repeat across batches either", () => {
    const rng = seeded(3);
    for (let i = 0; i < 200; i++) {
      const first = randomWords(1, rng);
      const next = randomWords(1, rng, first[0]);
      expect(next[0]).not.toBe(first[0]);
    }
  });

  it("can't loop forever on a constant random source", () => {
    const words = randomWords(10, () => 0);
    expect(words).toHaveLength(10);
    for (let i = 1; i < words.length; i++) expect(words[i]).not.toBe(words[i - 1]);
  });
});

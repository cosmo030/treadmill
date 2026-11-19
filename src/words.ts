// Word list and the random word stream.

/** About 300 common, short English words. Lowercase a–z only. */
export const WORDS: readonly string[] = [
  "the", "be", "to", "of", "and", "a", "in", "that", "have", "it",
  "for", "not", "on", "with", "he", "as", "you", "do", "at", "this",
  "but", "his", "by", "from", "they", "we", "say", "her", "she", "or",
  "an", "will", "my", "one", "all", "would", "there", "their", "what", "so",
  "up", "out", "if", "about", "who", "get", "which", "go", "me", "when",
  "make", "can", "like", "time", "no", "just", "him", "know", "take", "people",
  "into", "year", "your", "good", "some", "could", "them", "see", "other", "than",
  "then", "now", "look", "only", "come", "its", "over", "think", "also", "back",
  "after", "use", "two", "how", "our", "work", "first", "well", "way", "even",
  "new", "want", "any", "these", "give", "day", "most", "us", "is", "are",
  "was", "were", "been", "has", "had", "did", "said", "made", "find", "here",
  "thing", "many", "where", "long", "down", "life", "still", "own", "should", "must",
  "home", "under", "last", "never", "very", "hand", "high", "keep", "place", "small",
  "found", "great", "old", "big", "little", "while", "right", "might", "next", "open",
  "seem", "show", "every", "near", "add", "food", "plant", "light", "turn", "move",
  "live", "point", "page", "water", "line", "kind", "house", "again", "change", "off",
  "play", "spell", "air", "away", "study", "learn", "world", "school", "earth", "head",
  "stand", "grow", "story", "few", "north", "tree", "start", "city", "cross", "farm",
  "hard", "draw", "left", "late", "run", "real", "let", "above", "girl", "sea",
  "began", "idea", "fish", "once", "base", "hear", "horse", "cut", "sure", "watch",
  "color", "face", "wood", "main", "plain", "young", "ready", "ever", "red", "list",
  "though", "feel", "talk", "bird", "soon", "body", "dog", "pose", "leave", "song",
  "door", "black", "short", "class", "wind", "ship", "area", "half", "rock", "order",
  "fire", "south", "piece", "told", "knew", "pass", "since", "top", "whole", "king",
  "space", "heard", "best", "hour", "better", "true", "five", "step", "early", "hold",
  "west", "ground", "reach", "fast", "sing", "six", "table", "less", "ten", "simple",
  "war", "lay", "slow", "love", "money", "serve", "appear", "road", "map", "rain",
  "rule", "pull", "cold", "voice", "fall", "power", "town", "fine", "drive", "dark",
  "note", "wait", "plan", "star", "box", "field", "rest", "able", "done", "front",
  "teach", "week", "gave", "green", "quick", "warm", "free", "strong", "mind", "clear",
];

export type Rng = () => number;

/**
 * `count` random words. Never the same word twice in a row, including across
 * calls: pass the last word of the previous batch as `after`.
 */
export function randomWords(count: number, rng: Rng = Math.random, after?: string): string[] {
  const out: string[] = [];
  let prev = after;
  while (out.length < count) {
    const i = Math.min(WORDS.length - 1, Math.floor(rng() * WORDS.length));
    let word = WORDS[i] ?? "the";
    // A repeat takes the next word in the list instead of re-rolling, so a
    // broken (or constant) random source can never loop forever.
    if (word === prev) word = WORDS[(i + 1) % WORDS.length] ?? "the";
    out.push(word);
    prev = word;
  }
  return out;
}

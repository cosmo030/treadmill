// App setup: wires the game to the keyboard, the words on screen, the runner
// and the results panel.
import "./style.css";
import { Game } from "./game.ts";
import { createBestStore, shareText } from "./results.ts";
import { clackFor } from "./clack.ts";
import { createRunner } from "./runner.ts";
import { createKeySound, SOUND_KEY, soundPreference } from "./sound.ts";
import type { KeyInput, KeyOutcome, RunnerInput, Stats } from "./types.ts";
import { letterStates, type TypingSession } from "./typing.ts";

const THEME_KEY = "treadmill.theme";

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} is missing`);
  return node as T;
}

const el = {
  typing: $("typing"),
  viewport: $("viewport"),
  words: $("words"),
  caret: $("caret"),
  input: $<HTMLInputElement>("input"),
  overlay: $<HTMLButtonElement>("focus-overlay"),
  overlayLabel: $("focus-label"),
  results: $("results"),
  rWpm: $("r-wpm"),
  rAcc: $("r-acc"),
  rStumbles: $("r-stumbles"),
  rBest: $("r-best"),
  rBadge: $("r-best-badge"),
  share: $<HTMLButtonElement>("share"),
  shareNote: $("share-note"),
  again: $<HTMLButtonElement>("again"),
  restart: $<HTMLButtonElement>("restart"),
  hint: $("hint"),
  status: $("status"),
  theme: $<HTMLButtonElement>("theme"),
  sound: $<HTMLButtonElement>("sound"),
};

const coarse = matchMedia("(pointer: coarse)").matches;
const sound = createKeySound(soundPreference(readSetting(SOUND_KEY), coarse));
const game = new Game();
const best = createBestStore(safeStorage());
let newBest = false;

const runner = createRunner($<HTMLCanvasElement>("scene"), (): RunnerInput => {
  const now = performance.now();
  const s = game.state;
  return {
    phase: s.phase,
    liveWpm: game.liveWpm,
    consoleWpm: s.phase === "finished" ? s.stats.wpm : game.liveWpm,
    remainingSeconds: game.remainingMs(now) / 1000,
    elapsedSeconds: game.elapsedMs(now) / 1000,
    newBest,
  };
});

// ---------------------------------------------------------------------------
// Words on screen
// ---------------------------------------------------------------------------

/** Renders the word stream. Only touched words are rebuilt on each key. */
const words = {
  els: [] as HTMLSpanElement[],
  shownIndex: 0,

  reset(session: TypingSession): void {
    this.els = [];
    this.shownIndex = 0;
    el.words.replaceChildren(el.caret);
    this.append(session);
    this.renderWord(session, 0);
    this.place(session);
  },

  append(session: TypingSession): void {
    const frag = document.createDocumentFragment();
    for (let i = this.els.length; i < session.words.length; i++) {
      const w = document.createElement("span");
      w.className = "word";
      this.els.push(w);
      frag.append(w);
      this.fill(w, session.words[i] ?? "", "");
    }
    el.words.append(frag);
  },

  fill(w: HTMLSpanElement, target: string, typed: string): void {
    const letters = letterStates(target, typed).map((l) => {
      const span = document.createElement("span");
      span.className = `l ${l.state}`;
      span.textContent = l.char;
      return span;
    });
    w.replaceChildren(...letters);
  },

  renderWord(session: TypingSession, i: number): void {
    const w = this.els[i];
    if (!w) return;
    const typed = session.typed[i] ?? "";
    const target = session.words[i] ?? "";
    this.fill(w, target, typed);
    const past = i < session.index;
    w.classList.toggle("current", i === session.index);
    w.classList.toggle("bad", past && typed !== target);
  },

  /** After a key: rebuild the previous and current words, move the caret, scroll. */
  update(session: TypingSession): void {
    if (session.words.length > this.els.length) this.append(session);
    if (session.index !== this.shownIndex) this.renderWord(session, this.shownIndex);
    this.renderWord(session, session.index);
    this.shownIndex = session.index;
    this.place(session);
  },

  place(session: TypingSession): void {
    const w = this.els[session.index];
    if (!w) return;
    const letters = w.children;
    const pos = session.current.length;
    // Letters are positioned relative to their word (.word is position: relative).
    let x = w.offsetLeft;
    const at = letters[pos];
    const last = letters[letters.length - 1];
    if (at instanceof HTMLElement) x += at.offsetLeft;
    else if (last instanceof HTMLElement) x += last.offsetLeft + last.offsetWidth;
    const y = w.offsetTop;
    el.caret.style.transform = `translate(${x - 1}px, ${y}px)`;

    // Keep the current word on the second line once the player gets past the first.
    const line = w.offsetHeight || 1;
    el.words.style.transform = `translateY(${-Math.max(0, y - line)}px)`;
  },
};

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

/** Timer that turns the caret's blink back on after a pause in typing. */
let typingIdle = 0;

function press(input: KeyInput): void {
  const before = game.phase;
  if (before === "finished") return;
  const outcome: KeyOutcome = game.press(input, performance.now());
  if (game.phase === "finished") {
    finish();
    return;
  }
  // A real keyboard clacks even when the game ignores the key (e.g. space on an empty word).
  sound.play(clackFor(input.kind, outcome));
  if (outcome === "ignored") return;
  if (outcome === "wrong") runner.stumble();
  words.update(game.session);
  el.typing.classList.add("is-typing");
  clearTimeout(typingIdle);
  typingIdle = window.setTimeout(() => el.typing.classList.remove("is-typing"), 600);
  if (before === "ready") syncHint();
}

function restart(): void {
  game.restart();
  newBest = false;
  runner.reset();
  el.typing.classList.remove("is-finished");
  el.results.hidden = true;
  el.shareNote.textContent = "";
  words.reset(game.session);
  syncHint();
  el.status.textContent = "";
  focusInput();
}

function finish(): void {
  const s = game.state;
  if (s.phase !== "finished") return;
  const hadBest = best.read() > 0;
  const improved = best.offer(s.stats.wpm);
  // The very first round sets the best quietly; after that a new best is celebrated.
  newBest = improved && hadBest;
  showResults(s.stats);
  syncHint();
}

function showResults(stats: Stats): void {
  el.rWpm.textContent = String(stats.wpm);
  el.rAcc.textContent = `${stats.accuracy}%`;
  el.rStumbles.textContent = String(stats.stumbles);
  el.rBest.textContent = String(best.read());
  el.rBadge.hidden = !newBest;
  el.shareNote.textContent = "";
  el.typing.classList.add("is-finished");
  el.typing.classList.remove("is-typing");
  el.results.hidden = false;
  el.overlay.hidden = true;
  el.status.textContent = `time's up. ${stats.wpm} words per minute, ${stats.accuracy}% accuracy, ${stats.stumbles} stumbles.${newBest ? " new best!" : ""}`;
}

function syncHint(): void {
  const phase = game.state.phase;
  const text = phase === "ready" ? "start typing…" : phase === "running" ? "keep going…" : "time's up.";
  const keys = document.createElement("span");
  keys.className = "hint-keys";
  keys.textContent = phase === "finished" ? " · tab or enter to go again" : " · tab to restart";
  el.hint.replaceChildren(text, keys);
}

function loop(now: number): void {
  requestAnimationFrame(loop);
  if (game.tick(now)) finish();
}

// ---------------------------------------------------------------------------
// Input: physical keyboards via keydown, phone keyboards via input events
// ---------------------------------------------------------------------------

// The hidden input always holds this, so a phone's backspace has something to delete.
const SENTINEL = "__";
let composing = false;

function resetInputValue(): void {
  el.input.value = SENTINEL;
  try {
    el.input.setSelectionRange(SENTINEL.length, SENTINEL.length);
  } catch {
    // Some input types don't support selection; ours does.
  }
}

el.input.addEventListener("keydown", (e) => {
  if (e.key === "Tab" && !e.shiftKey) {
    e.preventDefault();
    restart();
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    restart();
    return;
  }
  if (e.isComposing || e.key === "Process" || e.key === "Unidentified") return; // let input events handle it
  if (e.key === "Backspace") {
    e.preventDefault();
    // Ctrl/Option/Cmd + Backspace clears the whole current word.
    press(e.ctrlKey || e.altKey || e.metaKey ? { kind: "clearWord" } : { kind: "backspace" });
    return;
  }
  if (e.metaKey || e.ctrlKey) return; // browser shortcuts
  if (e.key === " ") {
    e.preventDefault();
    press({ kind: "space" });
    return;
  }
  if (e.key.length === 1 && !e.altKey) {
    e.preventDefault();
    press({ kind: "char", char: e.key });
  }
});

// Only phone keyboards (and IMEs) get here: keydown above swallowed everything else.
el.input.addEventListener("beforeinput", (e) => {
  if (e.inputType === "insertFromPaste" || e.inputType === "insertFromDrop") e.preventDefault();
});

el.input.addEventListener("input", () => {
  const value = el.input.value;
  // Diff against the sentinel: deleted characters are backspaces, new ones are keys.
  let common = 0;
  while (common < SENTINEL.length && value[common] === SENTINEL[common]) common++;
  const deleted = SENTINEL.length - common;
  const added = value.slice(common);
  for (let i = 0; i < deleted; i++) press({ kind: "backspace" });
  // More than a couple of characters at once is autocomplete or a paste: ignore it.
  if (added.length <= 2) {
    for (const ch of added.toLowerCase()) press(ch === " " ? { kind: "space" } : { kind: "char", char: ch });
  }
  if (!composing) resetInputValue();
});

el.input.addEventListener("compositionstart", () => (composing = true));
el.input.addEventListener("compositionend", () => {
  composing = false;
  resetInputValue();
});

for (const type of ["paste", "drop", "cut"] as const) el.input.addEventListener(type, (e) => e.preventDefault());

// --- focus ---------------------------------------------------------------

function focusInput(): void {
  el.input.focus({ preventScroll: true });
  resetInputValue();
  syncOverlay();
}

function syncOverlay(): void {
  const focused = document.activeElement === el.input;
  el.overlay.hidden = focused || game.state.phase === "finished";
  el.overlayLabel.textContent = coarse ? "tap here to type" : "click here to type";
}

el.input.addEventListener("focus", () => {
  resetInputValue();
  syncOverlay();
  keepTypingVisible();
});
el.input.addEventListener("blur", () => {
  // Let a click on a button inside the frame settle first.
  setTimeout(syncOverlay, 0);
});
el.overlay.addEventListener("click", focusInput);
el.typing.addEventListener("pointerdown", (e) => {
  if (game.state.phase === "finished") return;
  if (e.target instanceof HTMLElement && e.target.closest("button")) return;
  // Taps land on the input itself; this covers clicks on the padding around it.
  if (e.target !== el.input) {
    e.preventDefault();
    focusInput();
  }
});

// Buttons shouldn't steal focus from the input on click, so typing carries on.
for (const b of [el.restart, el.theme, el.sound, el.share, el.again]) {
  b.addEventListener("mousedown", (e) => e.preventDefault());
}

// Phones: keep the words above the on-screen keyboard.
function keepTypingVisible(): void {
  requestAnimationFrame(() => {
    const vv = window.visualViewport;
    const rect = el.typing.getBoundingClientRect();
    const bottom = vv ? vv.height + vv.offsetTop : window.innerHeight;
    if (rect.bottom > bottom - 8 || rect.top < (vv?.offsetTop ?? 0)) {
      el.typing.scrollIntoView({ block: "center", behavior: "instant" });
    }
  });
}
window.visualViewport?.addEventListener("resize", () => {
  if (document.activeElement === el.input) keepTypingVisible();
});

// Tab / Enter also restart when focus is elsewhere on the page (but not on a
// button or link, where Enter should press it and Tab should move on).
document.addEventListener("keydown", (e) => {
  if (e.target === el.input) return;
  const onControl = e.target instanceof HTMLElement && e.target.closest("button, a, input");
  if (onControl) return;
  if ((e.key === "Tab" && !e.shiftKey) || e.key === "Enter") {
    e.preventDefault();
    restart();
  } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && game.phase !== "finished") {
    // Typing anywhere on the page goes to the game, including this key.
    e.preventDefault();
    focusInput();
    press(e.key === " " ? { kind: "space" } : { kind: "char", char: e.key });
  }
});

// --- buttons --------------------------------------------------------------

el.restart.addEventListener("click", restart);
el.again.addEventListener("click", restart);

el.share.addEventListener("click", async () => {
  const s = game.state;
  if (s.phase !== "finished") return;
  const text = shareText(s.stats);
  if (coarse && typeof navigator.share === "function") {
    try {
      await navigator.share({ text });
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      // Fall through to the clipboard.
    }
  }
  const ok = await copy(text);
  el.shareNote.textContent = ok ? "copied!" : text;
  window.setTimeout(() => {
    if (el.shareNote.textContent === "copied!") el.shareNote.textContent = "";
  }, 2000);
});

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers / insecure contexts: the textarea trick.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

// ---------------------------------------------------------------------------
// Theme (same as hangman)
// ---------------------------------------------------------------------------

function currentTheme(): "light" | "dark" {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function syncThemeButton(): void {
  const next = currentTheme() === "dark" ? "light" : "dark";
  el.theme.setAttribute("aria-label", `Switch to ${next} theme`);
  el.theme.title = `${next} theme`;
  const ground = getComputedStyle(document.documentElement).getPropertyValue("--ground").trim();
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", ground));
  runner.redraw();
}

// ---------------------------------------------------------------------------
// Typing sound toggle
// ---------------------------------------------------------------------------

function syncSoundButton(): void {
  el.sound.setAttribute("aria-pressed", String(sound.enabled));
  el.sound.title = sound.enabled ? "typing sound: on" : "typing sound: off";
}

// Audio can only start after a gesture. If one comes before the first key (a
// click, or the tap that opens a phone keyboard), start it then.
window.addEventListener("pointerdown", () => sound.warm(), { once: true, capture: true });

el.sound.addEventListener("click", () => {
  sound.setEnabled(!sound.enabled);
  writeSetting(SOUND_KEY, sound.enabled ? "on" : "off");
  syncSoundButton();
});

function readSetting(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSetting(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Applies for this visit only.
  }
}

el.theme.addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // The theme still applies for this visit.
  }
  syncThemeButton();
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncThemeButton);

function safeStorage(): Storage | null {
  try {
    localStorage.setItem("treadmill.test", "1");
    localStorage.removeItem("treadmill.test");
    return localStorage;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

words.reset(game.session);
syncHint();
syncThemeButton();
syncSoundButton();
// Re-measure once the web font has loaded (letter widths change).
document.fonts?.ready.then(() => words.place(game.session)).catch(() => {});
window.addEventListener("resize", () => words.place(game.session));
if (!coarse) focusInput();
syncOverlay();
requestAnimationFrame(loop);

#!/usr/bin/env node
import chalk from "chalk";
import Chance from "chance";
import { diffChars } from "diff";
import stripAnsi from "strip-ansi";

const chance = new Chance();

// Terminal codes
const T = {
  HIDE: "\x1b[?25l",
  SHOW: "\x1b[?25h",
  BELL: "\x07",
  CLEAR: "\x1bc",
  UP: (n) => `\x1b[${n}A`,
  SAVE: "\x1b7",
  RESTORE: "\x1b8",
  // Ghostty/Kitty underlines
  CURLY: "\x1b[4:3m",
  DASHED: "\x1b[4:5m",
  NO_UL: "\x1b[24m",
  STRIKE: "\x1b[9m",
  NO_STRIKE: "\x1b[29m",
};

// Colors - high contrast neons
const C = {
  pink: chalk.rgb(255, 40, 130),
  cyan: chalk.rgb(0, 255, 255),
  yellow: chalk.rgb(255, 230, 0),
  green: chalk.rgb(0, 255, 100),
  orange: chalk.rgb(255, 150, 0),
  purple: chalk.rgb(200, 80, 255),
  white: chalk.rgb(255, 255, 255),
  gray: chalk.rgb(90, 90, 100),
  dim: chalk.rgb(50, 50, 60),
  text: chalk.rgb(170, 170, 190),

  delBg: chalk.bgRgb(100, 0, 50),
  addBg: chalk.bgRgb(0, 80, 80),
};

// Rating thresholds (seconds)
const RATINGS = [
  { max: 1.5, label: "PERFECT", color: C.purple, mult: 4, sound: true },
  { max: 3.0, label: "FAST", color: C.cyan, mult: 3, sound: true },
  { max: 5.0, label: "GOOD", color: C.green, mult: 2, sound: false },
  { max: Infinity, label: "OK", color: C.gray, mult: 1, sound: false },
];

// Data generators
const DATA = [
  () => ({
    id: chance.guid().slice(0, 8),
    user: chance.name(),
    email: chance.email(),
    role: chance.pickone(["admin", "user", "mod"]),
    active: chance.bool(),
    score: chance.integer({ min: 0, max: 999 }),
  }),
  () => ({
    host: chance.domain(),
    ip: chance.ip(),
    port: chance.integer({ min: 1000, max: 9999 }),
    proto: chance.pickone(["tcp", "udp", "http"]),
    up: chance.bool(),
    load: chance.floating({ min: 0, max: 1, fixed: 2 }),
  }),
  () => ({
    tx: chance.hash({ length: 12 }),
    from: chance.hash({ length: 6 }),
    to: chance.hash({ length: 6 }),
    amt: chance.floating({ min: 1, max: 999, fixed: 2 }),
    cur: chance.pickone(["BTC", "ETH", "SOL"]),
    ok: chance.bool(),
  }),
];

let state = {
  score: 0,
  streak: 0,
  best: 0,
  round: 0,
  combo: 1,
  perfect: 0,
};

let challenge = null;
let timeLeft = 0;
let startTime = 0;
let timerRef = null;
let inputLocked = false;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const pad = (s, n) => {
  const v = stripAnsi(s).length;
  return s + " ".repeat(Math.max(0, n - v));
};

const cols = () => process.stdout.columns || 80;

// Flash effect
const flash = async (color, duration = 60) => {
  const w = cols();
  const flashLine = color(" ".repeat(w));
  process.stdout.write("\x1b[H" + flashLine);
  await sleep(duration);
};

// Generate challenge
const gen = (level) => {
  const base = chance.pickone(DATA)();
  const isDiff = chance.bool({ likelihood: 55 });
  const mod = isDiff ? { ...base } : base;

  if (isDiff) {
    const keys = Object.keys(base);
    const changes = Math.min(level + 1, keys.length);
    const toChange = chance.pickset(keys, changes);

    for (const k of toChange) {
      const v = base[k];
      if (typeof v === "string") {
        if (k === "email") mod[k] = chance.email();
        else if (k === "user") mod[k] = chance.name();
        else if (k === "ip") mod[k] = chance.ip();
        else if (k === "host") mod[k] = chance.domain();
        else mod[k] = chance.hash({ length: v.length });
      } else if (typeof v === "number") {
        mod[k] = Number.isInteger(v)
          ? v + chance.integer({ min: -5, max: 5 })
          : parseFloat((v + chance.floating({ min: -1, max: 1 })).toFixed(2));
      } else if (typeof v === "boolean") {
        mod[k] = !v;
      }
    }
  }

  return { a: base, b: mod, isDiff };
};

// Diff render
const diffLine = (a, b, show) => {
  if (!show || a === b) return { l: a, r: b };

  const parts = diffChars(a, b);
  let l = "", r = "";

  for (const p of parts) {
    if (p.removed) {
      l += C.delBg(C.pink(T.STRIKE + T.DASHED + p.value + T.NO_STRIKE + T.NO_UL));
    } else if (p.added) {
      r += C.addBg(C.cyan(T.CURLY + p.value + T.NO_UL));
    } else {
      l += p.value;
      r += p.value;
    }
  }
  return { l, r };
};

// Render panels
const renderPanels = (a, b, showDiff = false) => {
  const w = Math.floor((cols() - 7) / 2);
  const aLines = JSON.stringify(a, null, 2).split("\n");
  const bLines = JSON.stringify(b, null, 2).split("\n");
  const max = Math.max(aLines.length, bLines.length);

  let out = "";
  out += C.dim("  ╭" + "─".repeat(w) + "┬" + "─".repeat(w) + "╮\n");
  out += C.dim("  │") + C.pink(" a") + " ".repeat(w - 2) + C.dim("│") + C.cyan(" b") + " ".repeat(w - 2) + C.dim("│\n");
  out += C.dim("  ├" + "─".repeat(w) + "┼" + "─".repeat(w) + "┤\n");

  for (let i = 0; i < max; i++) {
    const al = aLines[i] || "";
    const bl = bLines[i] || "";

    let left = C.text(al);
    let right = C.text(bl);

    if (showDiff && al !== bl) {
      const d = diffLine(al, bl, true);
      left = d.l;
      right = d.r;
    }

    out += C.dim("  │") + pad(left, w) + C.dim("│") + pad(right, w) + C.dim("│\n");
  }

  out += C.dim("  ╰" + "─".repeat(w) + "┴" + "─".repeat(w) + "╯");
  return out;
};

// Timer bar with urgency
const timerBar = () => {
  const max = 20 - Math.floor(state.streak / 5) * 2;
  const pct = timeLeft / max;
  const barW = 12;
  const filled = Math.round(pct * barW);

  let color = C.green;
  let urgent = "";

  if (pct < 0.25) {
    color = C.pink;
    urgent = timeLeft <= 3 ? " !" : "";
  } else if (pct < 0.5) {
    color = C.yellow;
  }

  const bar = color("█".repeat(filled)) + C.dim("░".repeat(barW - filled));
  return C.dim("[") + bar + C.dim("]") + color(timeLeft + "s" + urgent);
};

// Status line
const statusLine = () => {
  const comboColor = state.combo >= 4 ? C.purple : state.combo >= 2 ? C.cyan : C.gray;
  const streakFire = state.streak >= 5 ? C.orange("🔥") : state.streak >= 3 ? C.yellow("·") : "";

  return "  " +
    C.gray("#") + C.white(state.round) + " " +
    C.yellow(state.score) + " " +
    C.green(state.streak) + streakFire + " " +
    comboColor("×" + state.combo) + " " +
    timerBar();
};

// Main render
const render = (showDiff = false) => {
  console.clear();
  process.stdout.write(T.HIDE);
  console.log("");
  console.log(statusLine());
  console.log("");
  console.log(renderPanels(challenge.a, challenge.b, showDiff));
  console.log("");
  console.log(C.dim("  [←] diff  [→] same"));
};

// Start round
const startRound = async () => {
  state.round++;
  challenge = gen(Math.floor(state.streak / 3));
  timeLeft = Math.max(10, 20 - Math.floor(state.streak / 5) * 2);
  startTime = Date.now();
  inputLocked = false;

  render();

  timerRef = setInterval(() => {
    timeLeft--;
    render();
    if (timeLeft <= 0) {
      clearInterval(timerRef);
      inputLocked = true;
      endRound(false);
    }
  }, 1000);
};

// End round
const endRound = async (correct) => {
  clearInterval(timerRef);
  inputLocked = true;

  const elapsed = (Date.now() - startTime) / 1000;
  const rating = RATINGS.find(r => elapsed <= r.max);

  if (correct) {
    // Score calculation
    const basePoints = 10;
    const points = basePoints * rating.mult * state.combo;
    state.score += points;
    state.streak++;
    state.best = Math.max(state.best, state.streak);

    // Increase combo
    if (rating.mult >= 3) {
      state.combo = Math.min(state.combo + 1, 8);
    }

    // Track perfects
    if (rating.label === "PERFECT") state.perfect++;

    // Feedback
    await flash(chalk.bgRgb(0, 50, 0), 40);
    console.clear();
    process.stdout.write(T.HIDE);
    console.log("");
    console.log("");

    const pts = C.yellow("+" + points);
    const rt = rating.color(rating.label);
    const tm = C.gray(elapsed.toFixed(2) + "s");
    const combo = state.combo > 1 ? C.purple(" ×" + state.combo) : "";

    console.log("  " + rt + " " + pts + combo);
    console.log("  " + tm);

    if (rating.sound) process.stdout.write(T.BELL);

    // Quick auto-continue
    await sleep(400);
    startRound();

  } else {
    // Wrong - break combo, show diff
    state.combo = 1;
    state.streak = 0;

    await flash(chalk.bgRgb(60, 0, 0), 50);
    console.clear();
    process.stdout.write(T.HIDE);
    console.log("");
    console.log("  " + C.pink("WRONG"));
    console.log("");
    console.log(renderPanels(challenge.a, challenge.b, true));
    console.log("");
    console.log(C.dim("  [→] continue  [q] quit"));

    waitForContinue();
  }
};

// Wait for continue
const waitForContinue = () => {
  const handler = (key) => {
    const k = key.toString();
    if (k === "\u001b[C" || k === "\r" || k === " ") {
      process.stdin.removeListener("data", handler);
      startRound();
    } else if (k === "q" || k === "\u0003") {
      showEnd();
    }
  };
  process.stdin.on("data", handler);
};

// Input handler
const handleInput = (key) => {
  if (inputLocked) return;

  const k = key.toString();
  if (k === "\u001b[D") { // Left = different
    inputLocked = true;
    endRound(challenge.isDiff);
  } else if (k === "\u001b[C") { // Right = same
    inputLocked = true;
    endRound(!challenge.isDiff);
  } else if (k === "\u0003") {
    process.stdout.write(T.SHOW);
    process.exit();
  }
};

// End screen
const showEnd = () => {
  console.clear();
  process.stdout.write(T.SHOW);

  const pct = state.round > 0 ? ((state.perfect / state.round) * 100).toFixed(0) : 0;

  console.log("");
  console.log("  " + C.white("delta-dojo"));
  console.log("  " + C.dim("─".repeat(20)));
  console.log("");
  console.log("  " + C.gray("score   ") + C.yellow(state.score));
  console.log("  " + C.gray("rounds  ") + C.white(state.round));
  console.log("  " + C.gray("best    ") + C.green(state.best));
  console.log("  " + C.gray("perfect ") + C.purple(state.perfect + " (" + pct + "%)"));
  console.log("");

  process.exit();
};

// Intro
const intro = async () => {
  console.clear();
  process.stdout.write(T.HIDE);

  console.log("");
  console.log("  " + C.cyan("delta-dojo"));
  console.log("  " + C.dim("spot the diff"));
  console.log("");
  console.log("  " + C.pink("←") + C.gray(" different"));
  console.log("  " + C.cyan("→") + C.gray(" same"));
  console.log("");
  console.log("  " + C.dim("fast = more points"));
  console.log("  " + C.dim("streak = harder + faster"));
  console.log("");
  console.log("  " + C.gray("press any key"));

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.once("data", (key) => {
    if (key.toString() === "\u0003") {
      process.stdout.write(T.SHOW);
      process.exit();
    }
    process.stdin.on("data", handleInput);
    startRound();
  });
};

// Cleanup
process.on("exit", () => process.stdout.write(T.SHOW));
process.on("SIGINT", () => { process.stdout.write(T.SHOW); process.exit(); });

intro();

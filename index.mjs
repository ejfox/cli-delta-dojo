#!/usr/bin/env node
import figlet from "figlet";
import chalk from "chalk";
import Chance from "chance";
import { diffChars } from "diff";
import stripAnsi from "strip-ansi";

const chance = new Chance();

// Terminal escape codes for Ghostty/Kitty advanced features
const SGR = {
  RESET: "\x1b[0m",
  BOLD: "\x1b[1m",
  DIM: "\x1b[2m",
  ITALIC: "\x1b[3m",
  BLINK: "\x1b[5m",
  UNDERLINE: {
    NONE: "\x1b[4:0m",
    STRAIGHT: "\x1b[4:1m",
    DOUBLE: "\x1b[4:2m",
    CURLY: "\x1b[4:3m",
    DOTTED: "\x1b[4:4m",
    DASHED: "\x1b[4:5m",
  },
  UNDERLINE_COLOR: (r, g, b) => `\x1b[58:2:${r}:${g}:${b}m`,
  STRIKETHROUGH: "\x1b[9m",
  NO_STRIKETHROUGH: "\x1b[29m",
  NO_UNDERLINE: "\x1b[24m",
  // Cursor control
  HIDE_CURSOR: "\x1b[?25l",
  SHOW_CURSOR: "\x1b[?25h",
  // Bell
  BELL: "\x07",
};

// Cyberpunk neon color palette
const CYBER = {
  neonPink: chalk.rgb(255, 0, 128),
  neonCyan: chalk.rgb(0, 255, 255),
  neonYellow: chalk.rgb(255, 255, 0),
  neonPurple: chalk.rgb(191, 0, 255),
  neonGreen: chalk.rgb(57, 255, 20),
  neonOrange: chalk.rgb(255, 165, 0),
  hotPink: chalk.rgb(255, 105, 180),
  electricBlue: chalk.rgb(125, 249, 255),
  darkBg: chalk.bgRgb(15, 15, 25),

  // Backgrounds
  deletionBg: chalk.bgRgb(80, 0, 40),
  additionBg: chalk.bgRgb(0, 60, 60),

  // Timer states
  timerFull: chalk.rgb(57, 255, 20),
  timerMid: chalk.rgb(255, 255, 0),
  timerLow: chalk.rgb(255, 0, 128),
  timerCritical: chalk.bgRgb(255, 0, 128).black,

  // UI
  border: chalk.rgb(60, 60, 80),
  borderBright: chalk.rgb(0, 255, 255),
  header: chalk.bold.rgb(255, 0, 128),
  muted: chalk.rgb(100, 100, 120),
  dim: chalk.rgb(60, 60, 80),
  text: chalk.rgb(180, 180, 200),
  textBright: chalk.rgb(220, 220, 240),
};

// Box drawing
const BOX = {
  topLeft: "╔", topRight: "╗", bottomLeft: "╚", bottomRight: "╝",
  horizontal: "═", vertical: "║",
  teeDown: "╦", teeUp: "╩", teeRight: "╠", teeLeft: "╣", cross: "╬",
  singleH: "─", singleV: "│",
  block: "█", blockLight: "░",
};

// Data templates for variety
const DATA_TEMPLATES = [
  // User profile
  () => ({
    id: chance.guid(),
    name: chance.name(),
    email: chance.email(),
    role: chance.pickone(["user", "admin", "mod", "guest"]),
    created: chance.date({ string: true, american: false }),
    active: chance.bool(),
    age: chance.age(),
    address: {
      street: chance.street(),
      city: chance.city(),
      state: chance.state(),
      zip: chance.zip(),
    },
    tags: chance.n(chance.word, chance.integer({ min: 1, max: 4 })),
  }),
  // Server config
  () => ({
    hostname: chance.domain(),
    ip: chance.ip(),
    port: chance.integer({ min: 1000, max: 9999 }),
    protocol: chance.pickone(["http", "https", "tcp", "udp"]),
    status: chance.pickone(["online", "offline", "maintenance"]),
    uptime: chance.floating({ min: 0, max: 99.99, fixed: 2 }),
    region: chance.pickone(["us-east", "us-west", "eu-central", "ap-south"]),
    ssl: chance.bool(),
    version: `${chance.integer({min:1,max:5})}.${chance.integer({min:0,max:9})}.${chance.integer({min:0,max:99})}`,
  }),
  // Transaction
  () => ({
    txId: chance.hash({ length: 16 }),
    from: chance.hash({ length: 8 }),
    to: chance.hash({ length: 8 }),
    amount: chance.floating({ min: 0.01, max: 9999.99, fixed: 2 }),
    currency: chance.pickone(["BTC", "ETH", "USDC", "SOL"]),
    timestamp: chance.timestamp(),
    confirmed: chance.bool(),
    gas: chance.integer({ min: 21000, max: 100000 }),
    memo: chance.sentence({ words: 3 }),
  }),
  // API response
  () => ({
    endpoint: "/" + chance.word() + "/" + chance.word(),
    method: chance.pickone(["GET", "POST", "PUT", "DELETE"]),
    status: chance.pickone([200, 201, 400, 401, 404, 500]),
    latency: chance.integer({ min: 10, max: 500 }),
    cached: chance.bool(),
    rateLimit: chance.integer({ min: 100, max: 1000 }),
    headers: {
      contentType: chance.pickone(["application/json", "text/html", "text/plain"]),
      auth: chance.pickone(["Bearer", "Basic", "None"]),
    },
  }),
];

const DIFFICULTY = ["LEVEL 1", "LEVEL 2", "LEVEL 3", "LEVEL 4", "LEVEL 5"];
const DIFFICULTY_ICONS = ["1", "2", "3", "4", "5"];

let state = {
  score: 0,
  streak: 0,
  maxStreak: 0,
  difficulty: 0,
  round: 0,
  correct: 0,
  incorrect: 0,
  totalTime: 0,
  fastestTime: Infinity,
};

let currentChallenge = null;
let currentTimeLeft = 0;
let roundStartTime = 0;

// Utility: sleep
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Utility: ANSI-aware padding
const padEndVisible = (str, len, char = " ") => {
  const visible = stripAnsi(str).length;
  return str + char.repeat(Math.max(0, len - visible));
};

const padStartVisible = (str, len, char = " ") => {
  const visible = stripAnsi(str).length;
  return char.repeat(Math.max(0, len - visible)) + str;
};

// Utility: center text
const centerText = (str, width) => {
  const visible = stripAnsi(str).length;
  const pad = Math.floor((width - visible) / 2);
  return " ".repeat(Math.max(0, pad)) + str;
};

// Get terminal dimensions
const getTermSize = () => ({
  cols: process.stdout.columns || 80,
  rows: process.stdout.rows || 24,
});

// Layout mode
const getLayoutMode = () => {
  const { cols } = getTermSize();
  if (cols >= 120) return "wide";
  if (cols >= 80) return "medium";
  return "narrow";
};

// Sound feedback
const beep = () => process.stdout.write(SGR.BELL);

// Character-level diff rendering
const renderCharDiff = (oldStr, newStr) => {
  if (oldStr === newStr) return { left: oldStr, right: newStr };

  const parts = diffChars(oldStr, newStr);
  let left = "";
  let right = "";

  for (const part of parts) {
    if (part.removed) {
      left += CYBER.deletionBg(CYBER.neonPink(SGR.STRIKETHROUGH + SGR.UNDERLINE.DASHED + part.value + SGR.NO_STRIKETHROUGH + SGR.NO_UNDERLINE));
    } else if (part.added) {
      right += CYBER.additionBg(CYBER.neonCyan(SGR.UNDERLINE.CURLY + part.value + SGR.NO_UNDERLINE));
    } else {
      left += part.value;
      right += part.value;
    }
  }

  return { left, right };
};

const renderLineDiff = (leftLine, rightLine, showDiff = false) => {
  if (!showDiff || leftLine === rightLine) {
    return { left: leftLine, right: rightLine };
  }
  return renderCharDiff(leftLine, rightLine);
};

// Side-by-side layout
const renderSideBySide = (left, right, changedFields = [], showDiff = false) => {
  const { cols } = getTermSize();
  const panelWidth = Math.floor((cols - 5) / 2);

  const leftLines = JSON.stringify(left, null, 2).split("\n");
  const rightLines = JSON.stringify(right, null, 2).split("\n");
  const maxLines = Math.max(leftLines.length, rightLines.length);

  let output = "";

  // Top border
  output += CYBER.border(BOX.topLeft) +
            CYBER.border(BOX.horizontal.repeat(panelWidth)) +
            CYBER.border(BOX.teeDown) +
            CYBER.border(BOX.horizontal.repeat(panelWidth)) +
            CYBER.border(BOX.topRight) + "\n";

  // Headers
  const leftHeader = CYBER.neonPink("a");
  const rightHeader = CYBER.neonCyan("b");
  output += CYBER.border(BOX.vertical) + " " +
            padEndVisible(leftHeader, panelWidth - 1) +
            CYBER.border(BOX.vertical) + " " +
            padEndVisible(rightHeader, panelWidth - 1) +
            CYBER.border(BOX.vertical) + "\n";

  // Separator
  output += CYBER.border(BOX.teeRight) + CYBER.border(BOX.horizontal.repeat(panelWidth)) +
            CYBER.border(BOX.cross) + CYBER.border(BOX.horizontal.repeat(panelWidth)) +
            CYBER.border(BOX.teeLeft) + "\n";

  // Content
  for (let i = 0; i < maxLines; i++) {
    const leftRaw = leftLines[i] || "";
    const rightRaw = rightLines[i] || "";

    let leftFormatted = CYBER.text(leftRaw);
    let rightFormatted = CYBER.text(rightRaw);

    if (showDiff && leftRaw !== rightRaw) {
      const diffResult = renderLineDiff(leftRaw, rightRaw, true);
      leftFormatted = diffResult.left;
      rightFormatted = diffResult.right;
    }

    // Line number gutter
    const lineNum = CYBER.dim((i + 1).toString().padStart(2, '0') + BOX.singleV);

    output += CYBER.border(BOX.vertical) + lineNum +
              padEndVisible(leftFormatted, panelWidth - 4) +
              CYBER.border(BOX.vertical) + lineNum +
              padEndVisible(rightFormatted, panelWidth - 4) +
              CYBER.border(BOX.vertical) + "\n";
  }

  // Bottom border
  output += CYBER.border(BOX.bottomLeft) +
            CYBER.border(BOX.horizontal.repeat(panelWidth)) +
            CYBER.border(BOX.teeUp) +
            CYBER.border(BOX.horizontal.repeat(panelWidth)) +
            CYBER.border(BOX.bottomRight);

  return output;
};

// Stacked layout
const renderStacked = (left, right, changedFields = [], showDiff = false) => {
  const { cols } = getTermSize();
  const panelWidth = cols - 4;

  const leftLines = JSON.stringify(left, null, 2).split("\n");
  const rightLines = JSON.stringify(right, null, 2).split("\n");

  let output = "";

  // Panel a
  output += CYBER.border(BOX.topLeft) +
            CYBER.neonPink(" a ") +
            CYBER.border(BOX.horizontal.repeat(Math.max(0, panelWidth - 5)) + BOX.topRight) + "\n";

  for (let i = 0; i < leftLines.length; i++) {
    const lineNum = CYBER.dim((i + 1).toString().padStart(2, '0') + BOX.singleV);
    output += CYBER.border(BOX.vertical) + lineNum +
              padEndVisible(CYBER.text(leftLines[i]), panelWidth - 5) +
              CYBER.border(BOX.vertical) + "\n";
  }
  output += CYBER.border(BOX.bottomLeft + BOX.horizontal.repeat(panelWidth) + BOX.bottomRight) + "\n";

  output += "\n";

  // Panel b
  output += CYBER.border(BOX.topLeft) +
            CYBER.neonCyan(" b ") +
            CYBER.border(BOX.horizontal.repeat(Math.max(0, panelWidth - 5)) + BOX.topRight) + "\n";

  for (let i = 0; i < rightLines.length; i++) {
    let line = rightLines[i];
    if (showDiff && leftLines[i] !== rightLines[i]) {
      const diffResult = renderLineDiff(leftLines[i] || "", rightLines[i], true);
      line = diffResult.right;
    } else {
      line = CYBER.text(line);
    }
    const lineNum = CYBER.dim((i + 1).toString().padStart(2, '0') + BOX.singleV);
    output += CYBER.border(BOX.vertical) + lineNum +
              padEndVisible(line, panelWidth - 5) +
              CYBER.border(BOX.vertical) + "\n";
  }
  output += CYBER.border(BOX.bottomLeft + BOX.horizontal.repeat(panelWidth) + BOX.bottomRight);

  return output;
};

const renderComparison = (left, right, changedFields = [], showDiff = false) => {
  const mode = getLayoutMode();
  return mode === "narrow"
    ? renderStacked(left, right, changedFields, showDiff)
    : renderSideBySide(left, right, changedFields, showDiff);
};

// Timer bar
const renderTimer = (timeLeft, maxTime) => {
  const { cols } = getTermSize();
  const barWidth = Math.min(15, cols - 40);
  const filled = Math.round((timeLeft / maxTime) * barWidth);
  const empty = barWidth - filled;
  const percentage = timeLeft / maxTime;

  let color;
  if (percentage > 0.5) {
    color = CYBER.timerFull;
  } else if (percentage > 0.25) {
    color = CYBER.timerMid;
  } else {
    color = CYBER.timerLow;
  }

  const filledBar = color(BOX.block.repeat(filled));
  const emptyBar = CYBER.dim(BOX.blockLight.repeat(empty));
  const timeDisplay = timeLeft <= 5
    ? CYBER.timerLow(timeLeft + "s")
    : CYBER.muted(timeLeft + "s");

  return "[" + filledBar + emptyBar + "] " + timeDisplay;
};

// Status bar
const renderStatus = () => {
  const maxTime = 30 - state.difficulty * 5;

  const round = CYBER.muted("#") + CYBER.textBright(state.round);
  const score = CYBER.neonYellow(state.score);
  const streak = CYBER.neonGreen(state.streak);
  const level = CYBER.muted("L") + CYBER.textBright(state.difficulty + 1);
  const timer = renderTimer(currentTimeLeft, maxTime);

  const sep = CYBER.dim(" ");
  return "  " + round + sep + score + sep + streak + sep + level + sep + timer;
};

// Instructions
const renderInstructions = () => {
  return "\n" + CYBER.muted("  [←] diff  [→] same");
};

// Generate challenge
const genChallenge = (d) => {
  const templateFn = chance.pickone(DATA_TEMPLATES);
  const base = templateFn();

  const isDiff = chance.bool({ likelihood: 55 });
  const mod = isDiff ? JSON.parse(JSON.stringify(base)) : base;
  const changedFields = [];

  if (isDiff) {
    const changes = Math.min(d + 1, Object.keys(base).length);
    const keys = Object.keys(base).filter(k => typeof base[k] !== 'object' || Array.isArray(base[k]));
    changedFields.push(...chance.pickset(keys, changes));

    changedFields.forEach((k) => {
      const val = base[k];
      if (typeof val === "string") {
        // Smart mutations based on field type
        if (k.includes("email")) mod[k] = chance.email();
        else if (k.includes("name") || k.includes("Name")) mod[k] = chance.name();
        else if (k.includes("ip")) mod[k] = chance.ip();
        else if (k.includes("hash") || k.includes("Id") || k.includes("id")) mod[k] = chance.hash({ length: val.length });
        else mod[k] = chance.string({ length: val.length, alpha: true });
      } else if (typeof val === "number") {
        if (Number.isInteger(val)) {
          mod[k] = val + chance.integer({ min: -10, max: 10 });
        } else {
          mod[k] = parseFloat((val + chance.floating({ min: -5, max: 5 })).toFixed(2));
        }
      } else if (typeof val === "boolean") {
        mod[k] = !val;
      } else if (Array.isArray(val)) {
        if (chance.bool()) {
          mod[k] = [...val, chance.word()];
        } else if (val.length > 1) {
          mod[k] = val.slice(0, -1);
        }
      }
    });
  }

  return { left: base, right: mod, isDiff, changedFields };
};

// Main render
const render = (ch, showDiff = false) => {
  console.clear();
  process.stdout.write(SGR.HIDE_CURSOR);
  console.log("");
  console.log(renderStatus());
  console.log("");
  console.log(renderComparison(ch.left, ch.right, ch.changedFields, showDiff));
  console.log(renderInstructions());
};

// Transition animation
const showTransition = async (message, color = CYBER.neonCyan) => {
  const { cols } = getTermSize();
  const frames = ["◐", "◓", "◑", "◒"];

  for (let i = 0; i < 6; i++) {
    console.clear();
    console.log("");
    console.log("");
    console.log(centerText(color(frames[i % 4] + " " + message + " " + frames[(i + 2) % 4]), cols));
    await sleep(80);
  }
};

// Play round
const play = async () => {
  state.round++;

  // Brief loading transition
  await showTransition("loading", CYBER.muted);

  const ch = genChallenge(state.difficulty);
  currentChallenge = ch;
  const maxTime = 30 - state.difficulty * 5;
  currentTimeLeft = maxTime;
  roundStartTime = Date.now();

  const timer = setInterval(() => {
    currentTimeLeft--;
    render(ch, false);
    if (currentTimeLeft <= 0) {
      clearInterval(timer);
      process.stdin.removeAllListeners("data");
      beep();
      console.log("\n" + CYBER.timerLow("  timeout"));
      end(false, ch);
    }
  }, 1000);

  render(ch, false);
  process.stdin.setRawMode(true);

  const handleKey = (key) => {
    const keyStr = key.toString();
    if (keyStr === "\u001b[D") { // Left = Different
      clearInterval(timer);
      process.stdin.removeListener("data", handleKey);
      end(ch.isDiff, ch);
    } else if (keyStr === "\u001b[C") { // Right = Same
      clearInterval(timer);
      process.stdin.removeListener("data", handleKey);
      end(!ch.isDiff, ch);
    } else if (keyStr === "\u0003") {
      process.stdout.write(SGR.SHOW_CURSOR);
      process.exit();
    }
  };

  process.stdin.on("data", handleKey);
};

const showDifference = (ch) => {
  return renderComparison(ch.left, ch.right, ch.changedFields, true);
};

// End round
const end = async (correct, ch) => {
  const responseTime = (Date.now() - roundStartTime) / 1000;
  state.totalTime += responseTime;

  console.clear();
  console.log("");

  if (correct) {
    state.correct++;
    state.score += (state.difficulty + 1) * 10;
    state.streak++;
    state.maxStreak = Math.max(state.maxStreak, state.streak);
    if (responseTime < state.fastestTime) state.fastestTime = responseTime;

    const points = (state.difficulty + 1) * 10;
    const bonus = responseTime < 3 ? " +QUICK!" : "";

    beep();

    console.log(CYBER.neonGreen("  CORRECT"));
    console.log("");
    console.log(CYBER.neonYellow("  +" + points) + CYBER.neonOrange(bonus));
    console.log(CYBER.muted("  " + responseTime.toFixed(1) + "s") +
                CYBER.muted("  streak: ") + CYBER.neonGreen(state.streak));
  } else {
    state.incorrect++;
    state.streak = 0;

    console.log(CYBER.neonPink("  WRONG"));
    console.log("");
    console.log(CYBER.muted("  diff:"));
    console.log("");
    console.log(showDifference(ch));
  }

  state.difficulty = Math.min(Math.floor(state.streak / 3), 4);

  console.log("");
  console.log(CYBER.dim("  " + BOX.singleH.repeat(30)));
  console.log(CYBER.muted("  [→/space] next  [q] quit"));

  const handleContinue = (key) => {
    const keyStr = key.toString().toLowerCase();
    if (keyStr === "\u001b[C" || keyStr === "\r" || keyStr === " ") {
      process.stdin.removeListener("data", handleContinue);
      play();
    } else if (keyStr === "q" || keyStr === "\u0003") {
      showStats();
    }
  };

  process.stdin.on("data", handleContinue);
};

// Final stats screen
const showStats = () => {
  console.clear();
  process.stdout.write(SGR.SHOW_CURSOR);

  const accuracy = state.round > 0 ? ((state.correct / state.round) * 100).toFixed(1) : 0;
  const avgTime = state.round > 0 ? (state.totalTime / state.round).toFixed(1) : 0;
  const fastest = state.fastestTime === Infinity ? "--" : state.fastestTime.toFixed(1);

  console.log("");
  console.log(CYBER.textBright("  delta-dojo session"));
  console.log(CYBER.dim("  " + BOX.singleH.repeat(25)));
  console.log("");
  console.log(CYBER.muted("  score:    ") + CYBER.neonYellow(state.score));
  console.log(CYBER.muted("  rounds:   ") + CYBER.textBright(state.round));
  console.log(CYBER.muted("  accuracy: ") + CYBER.textBright(accuracy + "%"));
  console.log(CYBER.muted("  streak:   ") + CYBER.neonGreen(state.maxStreak));
  console.log(CYBER.muted("  avg:      ") + CYBER.textBright(avgTime + "s"));
  console.log(CYBER.muted("  fastest:  ") + CYBER.neonCyan(fastest + "s"));
  console.log(CYBER.muted("  level:    ") + CYBER.textBright(DIFFICULTY[state.difficulty]));
  console.log("");
  console.log(CYBER.dim("  bye"));
  console.log("");

  process.exit();
};

// Handle resize
process.stdout.on("resize", () => {
  if (currentChallenge) {
    render(currentChallenge, false);
  }
});

// Boot sequence
const bootSequence = async () => {
  console.clear();
  process.stdout.write(SGR.HIDE_CURSOR);

  const { cols } = getTermSize();
  const bootLines = [
    { text: "delta-dojo v2.0.0", color: CYBER.neonCyan },
    { text: "loading diff engine...", color: CYBER.muted },
    { text: "initializing rng...", color: CYBER.muted },
    { text: "ready.", color: CYBER.neonGreen },
  ];

  console.log("");

  for (const line of bootLines) {
    const prefix = CYBER.neonPurple("[") + CYBER.neonYellow("*") + CYBER.neonPurple("]");
    process.stdout.write("  " + prefix + " ");

    // Typing effect
    for (const char of line.text) {
      process.stdout.write(line.color(char));
      await sleep(15 + Math.random() * 25);
    }
    console.log("");
    await sleep(150);
  }

  await sleep(400);

  // Title with glitch
  console.clear();

  const titleArt = `
  ${CYBER.neonCyan("╔══════════════════════════════════════╗")}
  ${CYBER.neonCyan("║")}                                        ${CYBER.neonCyan("║")}
  ${CYBER.neonCyan("║")}  ${CYBER.neonPink.bold("delta-dojo")}                            ${CYBER.neonCyan("║")}
  ${CYBER.neonCyan("║")}  ${CYBER.muted("json diff trainer")}                     ${CYBER.neonCyan("║")}
  ${CYBER.neonCyan("║")}                                        ${CYBER.neonCyan("║")}
  ${CYBER.neonCyan("╚══════════════════════════════════════╝")}
`;

  console.clear();
  console.log(titleArt);

  console.log("");
  console.log(CYBER.muted("  compare json objects. spot the diff."));
  console.log("");
  console.log("  " + CYBER.neonPink("←") + CYBER.muted(" different"));
  console.log("  " + CYBER.neonCyan("→") + CYBER.muted(" same"));
  console.log("");
  console.log(CYBER.dim("  " + BOX.singleH.repeat(30)));
  console.log(CYBER.muted("  press any key to start"));

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.once("data", (key) => {
    if (key.toString() === "\u0003") {
      process.stdout.write(SGR.SHOW_CURSOR);
      process.exit();
    }
    play();
  });
};

// Handle clean exit
process.on('exit', () => {
  process.stdout.write(SGR.SHOW_CURSOR);
});

process.on('SIGINT', () => {
  process.stdout.write(SGR.SHOW_CURSOR);
  process.exit();
});

// Start
bootSequence();

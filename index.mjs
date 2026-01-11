#!/usr/bin/env node
import chalk from "chalk";
import Chance from "chance";
import { diffChars } from "diff";
import stripAnsi from "strip-ansi";
import {
  loadOrCreateWallet,
  getWalletAddress,
  getBalance,
  getEntryFee,
  hasEnoughBalance,
  submitScore,
  getLeaderboard,
  requestAirdrop,
  getNetworkInfo,
} from "./chain.mjs";

// Terminal codes
const T = {
  HIDE: "\x1b[?25l",
  SHOW: "\x1b[?25h",
  BELL: "\x07",
  CURLY: "\x1b[4:3m",
  DASHED: "\x1b[4:5m",
  NO_UL: "\x1b[24m",
  STRIKE: "\x1b[9m",
  NO_STRIKE: "\x1b[29m",
};

// Colors
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

// Rating thresholds
const RATINGS = [
  { max: 1.5, label: "PERFECT", color: C.purple, mult: 4, sound: true },
  { max: 3.0, label: "FAST", color: C.cyan, mult: 3, sound: true },
  { max: 5.0, label: "GOOD", color: C.green, mult: 2, sound: false },
  { max: Infinity, label: "OK", color: C.gray, mult: 1, sound: false },
];

// Data generators
const DATA = [
  (c) => ({
    id: c.guid().slice(0, 8),
    user: c.name(),
    email: c.email(),
    role: c.pickone(["admin", "user", "mod"]),
    active: c.bool(),
    score: c.integer({ min: 0, max: 999 }),
  }),
  (c) => ({
    host: c.domain(),
    ip: c.ip(),
    port: c.integer({ min: 1000, max: 9999 }),
    proto: c.pickone(["tcp", "udp", "http"]),
    up: c.bool(),
    load: c.floating({ min: 0, max: 1, fixed: 2 }),
  }),
  (c) => ({
    tx: c.hash({ length: 12 }),
    from: c.hash({ length: 6 }),
    to: c.hash({ length: 6 }),
    amt: c.floating({ min: 1, max: 999, fixed: 2 }),
    cur: c.pickone(["BTC", "ETH", "SOL"]),
    ok: c.bool(),
  }),
];

// Game state
let gameSeed = Date.now();
let chance = new Chance(gameSeed);
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (s, n) => {
  const v = stripAnsi(s).length;
  return s + " ".repeat(Math.max(0, n - v));
};
const cols = () => process.stdout.columns || 80;

// Flash effect
const flash = async (color, duration = 60) => {
  const w = cols();
  process.stdout.write("\x1b[H" + color(" ".repeat(w)));
  await sleep(duration);
};

// Generate challenge (deterministic based on seed)
const gen = (level) => {
  const templateIndex = chance.integer({ min: 0, max: DATA.length - 1 });
  const base = DATA[templateIndex](chance);
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
  let l = "",
    r = "";
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

// Timer bar
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
  const streakFire = state.streak >= 5 ? C.orange("*") : state.streak >= 3 ? C.yellow(".") : "";
  return (
    "  " +
    C.gray("#") + C.white(state.round) + " " +
    C.yellow(state.score) + " " +
    C.green(state.streak) + streakFire + " " +
    comboColor("x" + state.combo) + " " +
    timerBar()
  );
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
  console.log(C.dim("  [<-] diff  [->] same"));
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
  const rating = RATINGS.find((r) => elapsed <= r.max);

  if (correct) {
    const basePoints = 10;
    const points = basePoints * rating.mult * state.combo;
    state.score += points;
    state.streak++;
    state.best = Math.max(state.best, state.streak);
    if (rating.mult >= 3) state.combo = Math.min(state.combo + 1, 8);
    if (rating.label === "PERFECT") state.perfect++;

    await flash(chalk.bgRgb(0, 50, 0), 40);
    console.clear();
    process.stdout.write(T.HIDE);
    console.log("");
    console.log("");

    const pts = C.yellow("+" + points);
    const rt = rating.color(rating.label);
    const tm = C.gray(elapsed.toFixed(2) + "s");
    const combo = state.combo > 1 ? C.purple(" x" + state.combo) : "";

    console.log("  " + rt + " " + pts + combo);
    console.log("  " + tm);

    if (rating.sound) process.stdout.write(T.BELL);

    await sleep(400);
    startRound();
  } else {
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
    console.log(C.dim("  [->] continue  [q] quit"));

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
      process.stdin.removeListener("data", handler);
      showEnd();
    }
  };
  process.stdin.on("data", handler);
};

// Input handler
const handleInput = (key) => {
  if (inputLocked) return;
  const k = key.toString();
  if (k === "\u001b[D") {
    inputLocked = true;
    endRound(challenge.isDiff);
  } else if (k === "\u001b[C") {
    inputLocked = true;
    endRound(!challenge.isDiff);
  } else if (k === "\u0003") {
    process.stdout.write(T.SHOW);
    process.exit();
  }
};

// End screen with leaderboard option
const showEnd = async () => {
  clearInterval(timerRef);
  console.clear();
  process.stdout.write(T.SHOW);

  const pct = state.round > 0 ? ((state.perfect / state.round) * 100).toFixed(0) : 0;

  console.log("");
  console.log("  " + C.white("delta-dojo"));
  console.log("  " + C.dim("─".repeat(25)));
  console.log("");
  console.log("  " + C.gray("score   ") + C.yellow(state.score));
  console.log("  " + C.gray("rounds  ") + C.white(state.round));
  console.log("  " + C.gray("best    ") + C.green(state.best));
  console.log("  " + C.gray("perfect ") + C.purple(state.perfect + " (" + pct + "%)"));
  console.log("  " + C.gray("seed    ") + C.dim(gameSeed));
  console.log("");

  if (state.score > 0) {
    console.log("  " + C.dim("─".repeat(25)));
    console.log("  " + C.cyan("[s]") + C.gray(" submit to blockchain leaderboard"));
    console.log("  " + C.dim("[enter] exit"));
    console.log("");

    process.stdin.setRawMode(true);
    process.stdin.resume();

    const handler = async (key) => {
      const k = key.toString().toLowerCase();
      if (k === "s") {
        process.stdin.removeListener("data", handler);
        await submitToLeaderboard();
      } else if (k === "\r" || k === "\u0003" || k === "q") {
        process.stdin.removeListener("data", handler);
        process.exit();
      }
    };
    process.stdin.on("data", handler);
  } else {
    process.exit();
  }
};

// Submit to blockchain leaderboard
const submitToLeaderboard = async () => {
  console.clear();
  console.log("");
  console.log("  " + C.cyan("blockchain leaderboard"));
  console.log("  " + C.dim("─".repeat(25)));
  console.log("");

  const wallet = loadOrCreateWallet();
  const address = getWalletAddress(wallet);
  const fee = getEntryFee();
  const network = getNetworkInfo();

  console.log("  " + C.gray("network  ") + C.dim(network.network));
  console.log("  " + C.gray("wallet   ") + C.dim(address.slice(0, 8) + "..." + address.slice(-4)));

  let balance;
  try {
    balance = await getBalance(wallet);
    console.log("  " + C.gray("balance  ") + C.yellow(balance.toFixed(4) + " SOL"));
  } catch (e) {
    console.log("  " + C.pink("error: ") + C.gray("could not fetch balance"));
    console.log("  " + C.dim(e.message));
    await waitForKey();
    process.exit();
    return;
  }

  console.log("  " + C.gray("fee      ") + C.yellow(fee.sol + " SOL") + C.dim(" (~$" + fee.usd + ")"));
  console.log("");

  const hasBalance = await hasEnoughBalance(wallet);

  if (!hasBalance) {
    console.log("  " + C.pink("insufficient balance"));
    console.log("");
    console.log("  " + C.gray("send SOL to:"));
    console.log("  " + C.cyan(address));
    console.log("");

    if (network.network === "devnet") {
      console.log("  " + C.dim("[a] request devnet airdrop"));
    }
    console.log("  " + C.dim("[enter] exit"));
    console.log("");

    const handler = async (key) => {
      const k = key.toString().toLowerCase();
      if (k === "a" && network.network === "devnet") {
        process.stdin.removeListener("data", handler);
        console.log("  " + C.gray("requesting airdrop..."));
        try {
          await requestAirdrop(wallet);
          console.log("  " + C.green("airdrop received!"));
          await sleep(1000);
          await submitToLeaderboard(); // retry
        } catch (e) {
          console.log("  " + C.pink("airdrop failed: ") + C.dim(e.message));
          await waitForKey();
          process.exit();
        }
      } else if (k === "\r" || k === "\u0003") {
        process.stdin.removeListener("data", handler);
        process.exit();
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", handler);
    return;
  }

  // Ask for name
  console.log("  " + C.gray("enter name (or enter for 'anon'):"));
  process.stdout.write("  > ");

  let playerName = "";
  process.stdin.setRawMode(false);

  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question("", async (name) => {
    rl.close();
    playerName = name.trim() || "anon";

    console.log("");
    console.log("  " + C.gray("submitting..."));

    try {
      const result = await submitScore(wallet, {
        score: state.score,
        seed: gameSeed,
        rounds: state.round,
        perfect: state.perfect,
        best: state.best,
        playerName,
      });

      console.log("");
      console.log("  " + C.green("submitted!"));
      console.log("  " + C.dim(result.explorer));
      console.log("");
    } catch (e) {
      console.log("");
      console.log("  " + C.pink("error: ") + C.dim(e.message));
      console.log("");
    }

    await waitForKey();
    process.exit();
  });
};

// Wait for any key
const waitForKey = () => {
  return new Promise((resolve) => {
    console.log("  " + C.dim("[enter] exit"));
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.once("data", () => resolve());
    } else {
      // Non-interactive, just exit
      resolve();
    }
  });
};

// Show leaderboard
const showLeaderboard = async () => {
  console.clear();
  console.log("");
  console.log("  " + C.cyan("delta-dojo leaderboard"));
  console.log("  " + C.dim("─".repeat(35)));
  console.log("");
  console.log("  " + C.gray("fetching from blockchain..."));

  try {
    const scores = await getLeaderboard(15);

    console.clear();
    console.log("");
    console.log("  " + C.cyan("delta-dojo leaderboard"));
    console.log("  " + C.dim("─".repeat(35)));
    console.log("");

    if (scores.length === 0) {
      console.log("  " + C.dim("no scores yet. be the first!"));
    } else {
      console.log("  " + C.dim("#   score   name         rounds"));
      console.log("  " + C.dim("─".repeat(35)));

      scores.forEach((s, i) => {
        const rank = (i + 1).toString().padStart(2);
        const score = s.score.toString().padStart(6);
        const name = s.name.slice(0, 10).padEnd(10);
        const rounds = s.rounds.toString().padStart(3);

        const rankColor = i === 0 ? C.yellow : i === 1 ? C.gray : i === 2 ? C.orange : C.dim;

        console.log(
          "  " +
            rankColor(rank) +
            "  " +
            C.yellow(score) +
            "   " +
            C.white(name) +
            "   " +
            C.dim(rounds)
        );
      });
    }

    console.log("");
    const network = getNetworkInfo();
    console.log("  " + C.dim("network: " + network.network));
    console.log("");
  } catch (e) {
    console.log("  " + C.pink("error: ") + C.dim(e.message));
    console.log("");
  }

  await waitForKey();
  process.exit();
};

// Intro
const intro = async () => {
  // Initialize new seed for this session
  gameSeed = Date.now();
  chance = new Chance(gameSeed);

  console.clear();
  process.stdout.write(T.HIDE);

  console.log("");
  console.log("  " + C.cyan("delta-dojo"));
  console.log("  " + C.dim("spot the diff"));
  console.log("");
  console.log("  " + C.pink("<-") + C.gray(" different"));
  console.log("  " + C.cyan("->") + C.gray(" same"));
  console.log("");
  console.log("  " + C.dim("fast = more points"));
  console.log("  " + C.dim("streak = harder + faster"));
  console.log("  " + C.dim("submit score to blockchain ($0.25)"));
  console.log("");
  console.log("  " + C.gray("press any key"));

  if (!process.stdin.isTTY) {
    console.log("  " + C.pink("error: requires interactive terminal"));
    process.exit(1);
  }
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

// Show wallet info
const showWallet = async () => {
  const wallet = loadOrCreateWallet();
  const addr = getWalletAddress(wallet);
  const info = getNetworkInfo();

  console.log("");
  console.log("  " + C.cyan("delta-dojo wallet"));
  console.log("  " + C.dim("─".repeat(35)));
  console.log("");
  console.log("  " + C.gray("address:"));
  console.log("  " + addr);
  console.log("");

  try {
    const bal = await getBalance(wallet);
    console.log("  " + C.gray("balance:") + " " + bal.toFixed(6) + " SOL");
    const fee = getEntryFee();
    const canSubmit = bal >= fee.sol + 0.001;
    console.log("  " + C.gray("entry fee:") + " " + fee.sol + " SOL (~$" + fee.usd + ")");
    console.log("  " + C.gray("can submit:") + " " + (canSubmit ? C.green("yes") : C.pink("no")));
  } catch (e) {
    console.log("  " + C.pink("could not fetch balance"));
  }

  console.log("");
  console.log("  " + C.gray("network:") + " " + info.network);
  console.log("  " + C.gray("path:") + " ~/.config/delta-dojo/wallet.json");
  console.log("");

  if (info.network === "devnet") {
    console.log("  " + C.dim("to fund on devnet:"));
    console.log("  " + C.dim("solana airdrop 1 " + addr + " --url devnet"));
    console.log("");
  }
};

// CLI args
const args = process.argv.slice(2);
if (args.includes("--leaderboard") || args.includes("-l")) {
  showLeaderboard();
} else if (args.includes("--wallet") || args.includes("-w")) {
  showWallet();
} else if (args.includes("--help") || args.includes("-h")) {
  console.log("");
  console.log("  delta-dojo - json diff trainer");
  console.log("");
  console.log("  usage:");
  console.log("    node index.mjs           start game");
  console.log("    node index.mjs -l        show leaderboard");
  console.log("    node index.mjs -w        show wallet");
  console.log("");
  console.log("  controls:");
  console.log("    <- arrow    objects are different");
  console.log("    -> arrow    objects are the same");
  console.log("    q           quit");
  console.log("");
  console.log("  blockchain:");
  console.log("    scores submitted to solana (~$0.25 fee)");
  console.log("    fund wallet on devnet to test");
  console.log("");
  process.exit();
} else {
  // Cleanup handlers
  process.on("exit", () => process.stdout.write(T.SHOW));
  process.on("SIGINT", () => {
    process.stdout.write(T.SHOW);
    process.exit();
  });

  intro();
}

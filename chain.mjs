// Solana blockchain integration for delta-dojo leaderboard
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import bs58 from "bs58";
import { createHash } from "crypto";
import Chance from "chance";

// Config
const CONFIG_DIR = join(homedir(), ".config", "delta-dojo");
const WALLET_PATH = join(CONFIG_DIR, "wallet.json");

// Treasury address - all leaderboard fees go here
// This is a dedicated address for delta-dojo leaderboard
const TREASURY = new PublicKey("7W8wQP4M93YMaTb2XSVECuXaNt5ttN7JWtuNB2ZzrvAM");

// Entry fee in SOL (~$0.25 at $180/SOL)
const ENTRY_FEE_SOL = 0.0014;
const ENTRY_FEE_LAMPORTS = Math.ceil(ENTRY_FEE_SOL * LAMPORTS_PER_SOL);

// Memo program ID (official Solana memo program)
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

// Network (switch to mainnet-beta for production)
const NETWORK = "devnet";
const RPC_URL = NETWORK === "devnet"
  ? "https://api.devnet.solana.com"
  : "https://api.mainnet-beta.solana.com";

// Create connection
const getConnection = () => new Connection(RPC_URL, "confirmed");

// Ensure config directory exists
const ensureConfigDir = () => {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
};

// Load or create wallet
export const loadOrCreateWallet = () => {
  ensureConfigDir();

  if (existsSync(WALLET_PATH)) {
    try {
      const data = JSON.parse(readFileSync(WALLET_PATH, "utf-8"));
      return Keypair.fromSecretKey(Uint8Array.from(data));
    } catch {
      // Corrupted wallet, create new
    }
  }

  // Create new wallet
  const keypair = Keypair.generate();
  writeFileSync(WALLET_PATH, JSON.stringify(Array.from(keypair.secretKey)));
  return keypair;
};

// Get wallet address as string
export const getWalletAddress = (wallet) => wallet.publicKey.toBase58();

// Get wallet balance in SOL
export const getBalance = async (wallet) => {
  const conn = getConnection();
  const balance = await conn.getBalance(wallet.publicKey);
  return balance / LAMPORTS_PER_SOL;
};

// Get entry fee info
export const getEntryFee = () => ({
  sol: ENTRY_FEE_SOL,
  lamports: ENTRY_FEE_LAMPORTS,
  usd: 0.25, // approximate
});

// Check if wallet has enough for submission
export const hasEnoughBalance = async (wallet) => {
  const balance = await getBalance(wallet);
  // Need entry fee + small amount for tx fee
  return balance >= ENTRY_FEE_SOL + 0.001;
};

// Create score memo data
// v3 includes chain verification: challenges depend on previous answers
const createScoreMemo = (scoreData) => {
  const { score, seed, rounds, perfect, best, playerName, chain, duration, history } = scoreData;
  const data = {
    v: 3, // version 3 with chain verification
    g: "delta-dojo",
    s: score,
    r: rounds,
    p: perfect,
    b: best,
    sd: seed,
    n: playerName || "anon",
    t: Date.now(),
    c: chain, // final chain state hash
    d: duration, // total game duration ms
    // history: "ans,ms;ans,ms;..." - correctness computed by verifier from chain replay
    // ans: 0=diff, 1=same, -1=timeout
    hs: history ? history.map((e) => e.join(",")).join(";") : "",
  };
  return JSON.stringify(data);
};

// Submit score to leaderboard
export const submitScore = async (wallet, scoreData) => {
  const conn = getConnection();
  const memo = createScoreMemo(scoreData);

  // Create transaction with:
  // 1. Transfer entry fee to treasury
  // 2. Memo with score data
  const tx = new Transaction();

  // Transfer entry fee to treasury
  tx.add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: TREASURY,
      lamports: ENTRY_FEE_LAMPORTS,
    })
  );

  // Add memo instruction
  tx.add({
    keys: [{ pubkey: wallet.publicKey, isSigner: true, isWritable: false }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(memo, "utf-8"),
  });

  // Send transaction
  const sig = await sendAndConfirmTransaction(conn, tx, [wallet], {
    commitment: "confirmed",
  });

  return {
    signature: sig,
    explorer: `https://explorer.solana.com/tx/${sig}?cluster=${NETWORK}`,
  };
};

// Fetch leaderboard from chain
export const getLeaderboard = async (limit = 20) => {
  const conn = getConnection();

  // Get recent signatures for treasury (incoming payments = score submissions)
  const sigs = await conn.getSignaturesForAddress(TREASURY, { limit: 100 });

  const scores = [];

  for (const sigInfo of sigs) {
    try {
      const tx = await conn.getTransaction(sigInfo.signature, {
        maxSupportedTransactionVersion: 0,
      });

      if (!tx?.meta?.logMessages) continue;

      // Find memo in logs
      for (const log of tx.meta.logMessages) {
        if (log.startsWith("Program log: Memo")) {
          // Extract memo data after "Program log: Memo (len X): "
          const match = log.match(/Memo \(len \d+\): (.+)/);
          if (match) {
            try {
              // Memo log may be double-encoded (outer string quotes)
              let data = JSON.parse(match[1]);
              if (typeof data === "string") data = JSON.parse(data);
              if (data.g === "delta-dojo") {
                scores.push({
                  score: data.s,
                  rounds: data.r,
                  perfect: data.p,
                  best: data.b,
                  name: data.n,
                  seed: data.sd,
                  time: data.t,
                  tx: sigInfo.signature,
                });
              }
            } catch {}
          }
        }
      }
    } catch {}
  }

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  return scores.slice(0, limit);
};

// Request airdrop (devnet only)
export const requestAirdrop = async (wallet, amount = 1) => {
  if (NETWORK !== "devnet") {
    throw new Error("Airdrop only available on devnet");
  }

  const conn = getConnection();
  const sig = await conn.requestAirdrop(
    wallet.publicKey,
    amount * LAMPORTS_PER_SOL
  );
  await conn.confirmTransaction(sig);
  return sig;
};

// Get network info
export const getNetworkInfo = () => ({
  network: NETWORK,
  rpc: RPC_URL,
  treasury: TREASURY.toBase58(),
  entryFee: ENTRY_FEE_SOL,
});

// ============== VERIFICATION ENGINE ==============
// Game logic for replaying and verifying submissions

// Data generators (must match index.mjs exactly)
const VERIFY_DATA = [
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

// Chain hash function (must match index.mjs)
const verifyChainHash = (state, answer, time) => {
  return createHash("sha256")
    .update(state + "|" + answer + "|" + time)
    .digest("hex")
    .slice(0, 16);
};

// Generate challenge (must match index.mjs exactly)
const verifyGen = (chance, level) => {
  const templateIndex = chance.integer({ min: 0, max: VERIFY_DATA.length - 1 });
  const base = VERIFY_DATA[templateIndex](chance);
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

  return { isDiff };
};

// Verify a score submission with chain replay
export const verifyScore = async (txSignature) => {
  const conn = getConnection();
  const tx = await conn.getTransaction(txSignature, {
    maxSupportedTransactionVersion: 0,
  });

  if (!tx) {
    return { valid: false, error: "transaction not found" };
  }

  // Find memo in logs
  let memoData = null;
  for (const log of tx.meta?.logMessages || []) {
    if (log.startsWith("Program log: Memo")) {
      const match = log.match(/Memo \(len \d+\): (.+)/);
      if (match) {
        try {
          let data = JSON.parse(match[1]);
          if (typeof data === "string") data = JSON.parse(data);
          if (data.g === "delta-dojo") {
            memoData = data;
            break;
          }
        } catch {}
      }
    }
  }

  if (!memoData) {
    return { valid: false, error: "no delta-dojo memo found" };
  }

  // Check version
  if (memoData.v < 3) {
    return {
      valid: null,
      warning: `v${memoData.v} submission - no chain verification`,
      data: memoData,
    };
  }

  // Parse history: [[answer, time], ...]
  const history = memoData.hs
    ? memoData.hs.split(";").map((e) => e.split(",").map(Number))
    : [];

  // Verify round count
  if (history.length !== memoData.r) {
    return {
      valid: false,
      error: `round count mismatch: claimed ${memoData.r}, history has ${history.length}`,
      data: memoData,
    };
  }

  // ===== CHAIN REPLAY =====
  // Replay the game to verify each answer was correct
  const seed = memoData.sd;
  let chainState = "";
  let calcScore = 0;
  let streak = 0;
  let combo = 1;
  let perfect = 0;
  let wrongAnswers = [];

  for (let i = 0; i < history.length; i++) {
    const [answer, ms] = history[i];

    // Compute chain seed for this round (must match game logic)
    const roundSeed = seed + (chainState ? parseInt(chainState, 16) : 0);

    // Generate challenge for this round
    const chance = new Chance(roundSeed);
    const challenge = verifyGen(chance, Math.floor(streak / 3));

    // Determine what the correct answer should be
    // answer: 0=different, 1=same; challenge.isDiff: true=different
    const correctAnswer = challenge.isDiff ? 0 : 1;
    const isCorrect = answer === correctAnswer;

    if (!isCorrect && answer !== -1) {
      wrongAnswers.push({
        round: i + 1,
        playerSaid: answer === 0 ? "different" : "same",
        actual: challenge.isDiff ? "different" : "same",
      });
    }

    // Update chain state (must match game logic)
    chainState = verifyChainHash(chainState, answer, ms);

    // Calculate score (same logic as game)
    if (isCorrect) {
      const elapsed = ms / 1000;
      let mult = 1;
      if (elapsed <= 1.5) {
        mult = 4;
        perfect++;
      } else if (elapsed <= 3) mult = 3;
      else if (elapsed <= 5) mult = 2;

      const points = 10 * mult * combo;
      calcScore += points;
      streak++;
      if (mult >= 3) combo = Math.min(combo + 1, 8);
    } else {
      combo = 1;
      streak = 0;
    }
  }

  // Verify final chain state matches
  if (chainState !== memoData.c) {
    return {
      valid: false,
      error: "chain state mismatch - history tampered",
      expectedChain: chainState,
      claimedChain: memoData.c,
      data: memoData,
    };
  }

  // Check for wrong answers that were claimed correct
  if (wrongAnswers.length > 0) {
    return {
      valid: false,
      error: `${wrongAnswers.length} incorrect answers detected`,
      wrongAnswers,
      data: memoData,
    };
  }

  // Verify score calculation
  if (calcScore !== memoData.s) {
    return {
      valid: false,
      error: `score mismatch: claimed ${memoData.s}, calculated ${calcScore}`,
      calculatedScore: calcScore,
      data: memoData,
    };
  }

  // Time bounds check
  const minTimePerRound = 200;
  const totalHistoryTime = history.reduce((sum, [, ms]) => sum + ms, 0);
  if (totalHistoryTime < history.length * minTimePerRound) {
    return {
      valid: false,
      error: `suspiciously fast: avg ${(totalHistoryTime / history.length).toFixed(0)}ms per round`,
      data: memoData,
    };
  }

  return {
    valid: true,
    verified: "chain",
    data: memoData,
    calculatedScore: calcScore,
    chainState,
    rounds: history.length,
  };
};

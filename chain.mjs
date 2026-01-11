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
// v2 includes verification fields: hash and duration
const createScoreMemo = (scoreData) => {
  const { score, seed, rounds, perfect, best, playerName, hash, duration, history } = scoreData;
  const data = {
    v: 2, // version 2 with verification
    g: "delta-dojo",
    s: score,
    r: rounds,
    p: perfect,
    b: best,
    sd: seed,
    n: playerName || "anon",
    t: Date.now(),
    h: hash, // history hash for verification
    d: duration, // total game duration ms
    // history is stored compressed: "ans,ms,ok;ans,ms,ok;..."
    // ans: 0=diff, 1=same, -1=timeout; ok: 0/1
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

// Verify a score submission
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
  if (memoData.v < 2) {
    return {
      valid: null,
      warning: "v1 submission - no verification data",
      data: memoData,
    };
  }

  // Parse history
  const history = memoData.hs
    ? memoData.hs.split(";").map((e) => e.split(",").map(Number))
    : [];

  // Verify round count matches history
  if (history.length !== memoData.r) {
    return {
      valid: false,
      error: `round count mismatch: claimed ${memoData.r}, history has ${history.length}`,
      data: memoData,
    };
  }

  // Verify score calculation from history
  // Scoring: base 10 points, multiplied by speed rating and combo
  // Speed ratings: PERFECT (<=1s, 4x), FAST (<=2s, 3x), GOOD (<=4s, 2x), OK (>4s, 1x)
  let calcScore = 0;
  let streak = 0;
  let combo = 1;
  let perfect = 0;

  for (const [ans, ms, correct] of history) {
    if (correct === 1) {
      const elapsed = ms / 1000;
      let mult = 1;
      if (elapsed <= 1) {
        mult = 4;
        perfect++;
      } else if (elapsed <= 2) mult = 3;
      else if (elapsed <= 4) mult = 2;

      const points = 10 * mult * combo;
      calcScore += points;
      streak++;
      if (mult >= 3) combo = Math.min(combo + 1, 8);
    } else {
      combo = 1;
      streak = 0;
    }
  }

  // Check score
  if (calcScore !== memoData.s) {
    return {
      valid: false,
      error: `score mismatch: claimed ${memoData.s}, calculated ${calcScore}`,
      calculatedScore: calcScore,
      data: memoData,
    };
  }

  // Check perfect count
  if (perfect !== memoData.p) {
    return {
      valid: false,
      error: `perfect count mismatch: claimed ${memoData.p}, calculated ${perfect}`,
      data: memoData,
    };
  }

  // Time bounds check: minimum reasonable time per round
  const minTimePerRound = 200; // 200ms minimum reaction time
  const totalHistoryTime = history.reduce((sum, [, ms]) => sum + ms, 0);
  if (totalHistoryTime < history.length * minTimePerRound) {
    return {
      valid: false,
      error: `suspiciously fast: avg ${(totalHistoryTime / history.length).toFixed(0)}ms per round`,
      data: memoData,
    };
  }

  // Duration check: history time should roughly match claimed duration
  const durationDiff = Math.abs(memoData.d - totalHistoryTime);
  if (durationDiff > 5000 + history.length * 1000) {
    return {
      valid: false,
      error: `duration mismatch: claimed ${memoData.d}ms, history totals ${totalHistoryTime}ms`,
      data: memoData,
    };
  }

  return {
    valid: true,
    data: memoData,
    calculatedScore: calcScore,
    history,
  };
};

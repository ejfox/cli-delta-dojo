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
const createScoreMemo = (score, seed, rounds, perfect, best, playerName) => {
  const data = {
    v: 1, // version
    g: "delta-dojo",
    s: score,
    r: rounds,
    p: perfect,
    b: best,
    sd: seed,
    n: playerName || "anon",
    t: Date.now(),
  };
  return JSON.stringify(data);
};

// Submit score to leaderboard
export const submitScore = async (wallet, scoreData) => {
  const { score, seed, rounds, perfect, best, playerName } = scoreData;

  const conn = getConnection();
  const memo = createScoreMemo(score, seed, rounds, perfect, best, playerName);

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

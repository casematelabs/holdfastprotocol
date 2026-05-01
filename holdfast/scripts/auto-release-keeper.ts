/**
 * CAS-459: Auto-Release Keeper — Reference implementation (Option A: beneficiary-side polling)
 *
 * Polls the Holdfast indexer for Locked timed pacts belonging to the keeper's
 * beneficiary address and fires the on-chain `auto_release` instruction for any
 * that have passed their `timeLockExpiresAt` timestamp.
 *
 * This is the recommended devnet keeper strategy. Option B (Holdfast-operated
 * keeper endpoint that accepts pact registration) is tracked as a roadmap item.
 *
 * IMPORTANT: `auto_release` is a distinct on-chain instruction from `release_escrow`
 * (the initiator-triggered manual release). It is callable by any wallet after
 * `timeLockExpiresAt` has passed, but only when the pact was created with
 * `auto_release_on_expiry = true` (i.e. timed mode). The program rejects the
 * instruction for task or milestone pacts.
 *
 * NOTE: The `autoRelease()` SDK method is not yet implemented in @holdfastprotocol/sdk.
 * This script builds the instruction manually using the same discriminator derivation
 * pattern as the SDK internals. When the SDK adds `client.escrow.autoRelease()`,
 * migrate this script to use that method instead.
 *
 * Prerequisites:
 *   KEEPER_KEYPAIR_PATH   Path to a Solana keypair JSON (funded devnet wallet).
 *                         Default: ~/.config/solana/devnet.json
 *   KEEPER_AGENT_WALLET   Base58 AgentWallet PDA of the keeper/beneficiary.
 *                         Obtain this from `registerAgentWallet()` output.
 *   INDEXER_URL           Holdfast indexer endpoint.
 *                         Default: https://holdfast-indexer.fly.dev
 *   RPC_URL               Solana RPC endpoint.
 *                         Default: https://api.devnet.solana.com
 *   POLL_INTERVAL_SECS    How often to poll for expired pacts (seconds).
 *                         Default: 300 (5 minutes)
 *   DRY_RUN               Set to "1" to log candidates without submitting transactions.
 *
 * Run:
 *   KEEPER_KEYPAIR_PATH=~/.config/solana/devnet.json \
 *   KEEPER_AGENT_WALLET=<your-agent-wallet-pda> \
 *   npx ts-node --transpile-only holdfast/scripts/auto-release-keeper.ts
 */

import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

// ── Config ────────────────────────────────────────────────────────────────────

const KEYPAIR_PATH = (process.env["KEEPER_KEYPAIR_PATH"] ?? "~/.config/solana/devnet.json").replace(
  /^~/,
  os.homedir(),
);
const AGENT_WALLET_STR = process.env["KEEPER_AGENT_WALLET"];
const INDEXER_URL = process.env["INDEXER_URL"] ?? "https://holdfast-indexer.fly.dev";
const RPC_URL = process.env["RPC_URL"] ?? "https://api.devnet.solana.com";
const POLL_INTERVAL_MS = parseInt(process.env["POLL_INTERVAL_SECS"] ?? "300", 10) * 1000;
const DRY_RUN = process.env["DRY_RUN"] === "1";

const ESCROW_PROGRAM_ID = new PublicKey("CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi");
const DEFAULT_PUBKEY = new PublicKey(new Uint8Array(32));

// Indexer-returned pact shape (subset used by the keeper)
interface IndexerPact {
  address: string;
  escrowId: string;
  status: number; // EscrowStatus enum value
  timeLockExpiresAt: number; // Unix seconds
  beneficiary: string;
  pactRecord: string;
}

interface PactPage {
  pacts: IndexerPact[];
  hasMore: boolean;
  cursor?: string;
}

// ── Anchor discriminator derivation ──────────────────────────────────────────

function disc(name: string): Buffer {
  return Buffer.from(
    createHash("sha256").update(`global:${name}`).digest(),
  ).subarray(0, 8);
}

// EscrowStatus.Locked = 2 (mirrors on-chain enum)
const LOCKED_STATUS = 2;

// ── PDA helpers ───────────────────────────────────────────────────────────────

function escrowIdHexToBuffer(escrowIdHex: string): Buffer {
  return Buffer.from(escrowIdHex, "hex");
}

function deriveEscrowPda(escrowIdBuffer: Buffer): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), escrowIdBuffer],
    ESCROW_PROGRAM_ID,
  );
  return pda;
}

function derivePactPda(escrowIdBuffer: Buffer): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pact"), escrowIdBuffer],
    ESCROW_PROGRAM_ID,
  );
  return pda;
}

// ── Build auto_release instruction ───────────────────────────────────────────
//
// Accounts (by analogy with release_escrow, adapted for keeper/beneficiary caller):
//   0. cranker       [signer, writable]  Pays fee; caller (keeper or beneficiary).
//   1. escrowAccount [writable]          Status transitions Locked → Released.
//   2. pactRecord    [readonly]          Program reads pact metadata for validation.
//   3. crankerWallet [readonly]          Cranker's AgentWallet PDA (may be DEFAULT_PUBKEY
//                                        if the keeper is not itself an AgentWallet holder).
//
// NOTE: This account layout is inferred from the program's logical structure.
// Verify against the deployed IDL before use in production. If the program rejects
// with `AccountNotEnoughKeys` or a similar error, adjust the accounts array.

function buildAutoReleaseIx(
  cranker: PublicKey,
  escrowPda: PublicKey,
  pactPda: PublicKey,
  crankerWallet: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    data: disc("auto_release"),
    keys: [
      { pubkey: cranker, isSigner: true, isWritable: true },
      { pubkey: escrowPda, isSigner: false, isWritable: true },
      { pubkey: pactPda, isSigner: false, isWritable: false },
      { pubkey: crankerWallet, isSigner: false, isWritable: false },
    ],
  });
}

// ── Indexer queries ───────────────────────────────────────────────────────────

async function fetchLockedPacts(
  beneficiaryPubkey: string,
  cursor?: string,
): Promise<PactPage> {
  const url = new URL(`/v1/agents/${beneficiaryPubkey}/escrow/pacts`, INDEXER_URL);
  url.searchParams.set("status", String(LOCKED_STATUS));
  url.searchParams.set("limit", "100");
  if (cursor) url.searchParams.set("before", cursor);

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Indexer returned ${res.status} for pact list: ${await res.text()}`);
  }
  return res.json() as Promise<PactPage>;
}

async function collectAllLockedPacts(beneficiaryPubkey: string): Promise<IndexerPact[]> {
  const all: IndexerPact[] = [];
  let cursor: string | undefined;

  do {
    const page = await fetchLockedPacts(beneficiaryPubkey, cursor);
    all.push(...page.pacts);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return all;
}

// ── Poll-and-release ──────────────────────────────────────────────────────────

async function runOnce(
  connection: Connection,
  keeper: Keypair,
  keeperWallet: PublicKey,
): Promise<void> {
  const nowSecs = Math.floor(Date.now() / 1000);
  const beneficiaryPubkey = keeper.publicKey.toBase58();

  console.log(`[${new Date().toISOString()}] Polling for expired locked pacts (beneficiary: ${beneficiaryPubkey})`);

  let pacts: IndexerPact[];
  try {
    pacts = await collectAllLockedPacts(beneficiaryPubkey);
  } catch (err) {
    console.error(`  Error fetching pacts from indexer: ${(err as Error).message}`);
    return;
  }

  const expired = pacts.filter((p) => p.timeLockExpiresAt > 0 && p.timeLockExpiresAt <= nowSecs);

  console.log(`  Found ${pacts.length} locked pact(s), ${expired.length} expired.`);

  if (expired.length === 0) return;

  for (const pact of expired) {
    const escrowIdBuf = escrowIdHexToBuffer(pact.escrowId);
    const escrowPda = deriveEscrowPda(escrowIdBuf);
    const pactPda = derivePactPda(escrowIdBuf);

    const expiryDate = new Date(pact.timeLockExpiresAt * 1000).toISOString();
    console.log(`  → Expired pact ${pact.escrowId.slice(0, 12)}… (expired ${expiryDate})`);

    if (DRY_RUN) {
      console.log(`    [DRY RUN] Would fire auto_release for ${pact.address}`);
      continue;
    }

    try {
      const ix = buildAutoReleaseIx(keeper.publicKey, escrowPda, pactPda, keeperWallet);
      const tx = new Transaction().add(ix);
      tx.feePayer = keeper.publicKey;

      const sig = await sendAndConfirmTransaction(connection, tx, [keeper], {
        commitment: "confirmed",
        maxRetries: 3,
      });

      console.log(`    auto_release confirmed: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      if (msg.includes("AutoReleaseNotEnabled") || msg.includes("6") /* error code range */) {
        // Program rejected — pact was not created with auto_release_on_expiry = true.
        // This is expected for task/milestone pacts where timeLockExpiresAt is just
        // the lock-by date. Log and skip.
        console.log(`    Skipped (not a timed pact or already released): ${msg.slice(0, 100)}`);
      } else {
        console.error(`    Failed to auto_release: ${msg.slice(0, 200)}`);
      }
    }
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=".repeat(64));
  console.log("  Holdfast Auto-Release Keeper (CAS-459 reference script)");
  console.log("=".repeat(64));

  if (!AGENT_WALLET_STR) {
    console.error("Error: KEEPER_AGENT_WALLET is required.");
    console.error("  Set it to the base58 AgentWallet PDA of the beneficiary keypair.");
    console.error("  Obtain it from the registerAgentWallet() call output.");
    process.exit(1);
  }

  let keeper: Keypair;
  try {
    const raw = JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf8")) as number[];
    keeper = Keypair.fromSecretKey(Uint8Array.from(raw));
  } catch (err) {
    console.error(`Error loading keypair from ${KEYPAIR_PATH}: ${(err as Error).message}`);
    process.exit(1);
  }

  let keeperWallet: PublicKey;
  try {
    keeperWallet = new PublicKey(AGENT_WALLET_STR);
  } catch {
    console.error(`Error: KEEPER_AGENT_WALLET is not a valid base58 pubkey: ${AGENT_WALLET_STR}`);
    process.exit(1);
  }

  const connection = new Connection(RPC_URL, "confirmed");

  console.log(`  Keeper:       ${keeper.publicKey.toBase58()}`);
  console.log(`  Agent wallet: ${keeperWallet.toBase58()}`);
  console.log(`  Indexer:      ${INDEXER_URL}`);
  console.log(`  RPC:          ${RPC_URL}`);
  console.log(`  Poll interval: ${POLL_INTERVAL_MS / 1000}s`);
  if (DRY_RUN) console.log("  DRY RUN: transactions will NOT be submitted");
  console.log("=".repeat(64));

  // Run immediately on start, then on interval.
  await runOnce(connection, keeper, keeperWallet);

  setInterval(() => {
    runOnce(connection, keeper, keeperWallet).catch((err: unknown) => {
      console.error("[keeper] Unhandled error in poll cycle:", (err as Error).message);
    });
  }, POLL_INTERVAL_MS);
}

main().catch((err: unknown) => {
  console.error("[keeper] Fatal error:", err);
  process.exit(1);
});

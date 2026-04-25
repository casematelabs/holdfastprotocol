/**
 * Holdfast Protocol — Quickstart Example App
 *
 * Runs a complete pact lifecycle on Solana devnet:
 *   register wallet → read reputation → create pact →
 *   deposit → stake beneficiary → lock → release
 *
 * Prerequisites
 * ─────────────
 * 1. Generate and fund a devnet keypair:
 *      solana-keygen new -o ~/.config/solana/devnet.json
 *      solana airdrop 2 --url devnet
 *
 * 2. Wrap some SOL into wSOL (the escrow token for this demo):
 *      spl-token wrap 0.1 --fee-payer ~/.config/solana/devnet.json
 *
 * 3. Copy .env.example → .env and fill in KEYPAIR_PATH.
 *
 * Run
 * ───
 *   npm install && npm start
 *
 * DEVNET ONLY. Pre-audit release. Not for production use.
 */

import "dotenv/config";
import {
  createHoldfastClient,
  registerAgentWallet,
  ReputationNotFoundError,
  EscrowStatus,
  VerifTier,
} from "@holdfastprotocol/sdk";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadKeypair(envPath: string | undefined, label: string): Keypair {
  const raw = (envPath ?? `${os.homedir()}/.config/solana/devnet.json`).replace(
    /^~/,
    os.homedir(),
  );
  if (!fs.existsSync(raw)) {
    throw new Error(
      `${label} keypair not found at: ${raw}\n` +
        `  Generate one with: solana-keygen new -o ${raw}\n` +
        `  Fund it with:      solana airdrop 2 --url devnet`,
    );
  }
  const secret = JSON.parse(fs.readFileSync(raw, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

const TIER_LABELS: Record<VerifTier, string> = {
  [VerifTier.Unverified]: "Unverified",
  [VerifTier.Attested]: "Attested (secp256r1)",
  [VerifTier.Hardline]: "Hardline (TEE-attested)",
};

function statusLabel(s: EscrowStatus): string {
  const labels: Partial<Record<EscrowStatus, string>> = {
    [EscrowStatus.Pending]: "Pending",
    [EscrowStatus.Funded]: "Funded",
    [EscrowStatus.Locked]: "Locked",
    [EscrowStatus.Released]: "Released",
    [EscrowStatus.Disputed]: "Disputed",
    [EscrowStatus.Refunded]: "Refunded",
    [EscrowStatus.Closed]: "Closed",
    [EscrowStatus.Claimed]: "Claimed",
    [EscrowStatus.MutuallyCancelled]: "MutuallyCancelled",
  };
  return labels[s] ?? `Unknown(${s})`;
}

function explorerTx(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

function explorerAddr(addr: string): string {
  return `https://explorer.solana.com/address/${addr}?cluster=devnet`;
}

function step(n: number, label: string): void {
  const line = `─`.repeat(Math.max(1, 58 - label.length));
  console.log(`\n── Step ${n}: ${label} ${line}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(
    "\n╔══════════════════════════════════════════════════════════════╗\n" +
      "║   Holdfast Protocol — Quickstart Example App                ║\n" +
      "║   DEVNET ONLY · Pre-audit release · Not for production      ║\n" +
      "╚══════════════════════════════════════════════════════════════╝",
  );

  // ── Load keypairs ─────────────────────────────────────────────────────────

  const initiatorKeypair = loadKeypair(process.env["KEYPAIR_PATH"], "Initiator");

  // Optional second keypair for a genuine two-party pact.
  // When omitted the same key acts as both sides ("self-pact" demo).
  const counterpartyKeypair = process.env["COUNTERPARTY_KEYPAIR_PATH"]
    ? loadKeypair(process.env["COUNTERPARTY_KEYPAIR_PATH"], "Counterparty")
    : initiatorKeypair;

  const rpcUrl = process.env["RPC_URL"] ?? "https://api.devnet.solana.com";
  const isSelfPact = initiatorKeypair.publicKey.equals(counterpartyKeypair.publicKey);

  console.log(`\nInitiator:    ${initiatorKeypair.publicKey.toBase58()}`);
  console.log(
    `Counterparty: ${counterpartyKeypair.publicKey.toBase58()}${isSelfPact ? "  (self-pact)" : ""}`,
  );
  console.log(`RPC:          ${rpcUrl}`);

  const connection = new Connection(rpcUrl, "confirmed");

  // ── Step 1: Register AgentWallet (idempotent) ─────────────────────────────

  step(1, "Register AgentWallet");

  const initReg = await registerAgentWallet({ connection, signer: initiatorKeypair });
  const agentWallet = initReg.agentWallet;
  if (initReg.signature) {
    console.log(`  ✓ Registered: ${agentWallet.toBase58()}`);
    console.log(`    Explorer:   ${explorerTx(initReg.signature)}`);
  } else {
    console.log(`  ✓ Already registered: ${agentWallet.toBase58()}`);
  }
  console.log(`    ${explorerAddr(agentWallet.toBase58())}`);

  let counterpartyWallet: PublicKey;
  if (isSelfPact) {
    counterpartyWallet = agentWallet;
  } else {
    const cpReg = await registerAgentWallet({ connection, signer: counterpartyKeypair });
    counterpartyWallet = cpReg.agentWallet;
    if (cpReg.signature) {
      console.log(`  ✓ Counterparty registered: ${counterpartyWallet.toBase58()}`);
    } else {
      console.log(`  ✓ Counterparty already registered: ${counterpartyWallet.toBase58()}`);
    }
  }

  // ── Step 2: Read reputation ───────────────────────────────────────────────

  step(2, "Read Reputation");

  // createHoldfastClient without a signer — read-only operations only
  const readClient = createHoldfastClient({ rpcUrl });

  try {
    const rep = await readClient.reputation.get(initiatorKeypair.publicKey);
    const pct = ((rep.score / 10_000) * 100).toFixed(1);
    console.log(`  Score:       ${rep.score} / 10,000 bp  (${pct}%)`);
    console.log(`  Tier:        ${TIER_LABELS[rep.tier]}`);
    console.log(`  Total pacts: ${rep.totalPacts}`);
    console.log(`  Disputes:    ${rep.disputeCount}`);
  } catch (err) {
    if (err instanceof ReputationNotFoundError) {
      console.log("  No ReputationAccount yet — will be created on first pact signature.");
    } else {
      throw err;
    }
  }

  const eligible = await readClient.reputation.meetsRequirements(initiatorKeypair.publicKey, {
    minScore: 0,
  });
  console.log(`  Requirements check (minScore: 0): ${eligible ? "PASS ✓" : "FAIL"}`);

  // ── Step 3: Create pact ───────────────────────────────────────────────────

  step(3, "Create Pact");

  // Wrapped SOL mint — wrap native SOL first with `spl-token wrap 0.1`
  const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
  const amount = 10_000n; // 0.00001 wSOL — minimal amount for devnet testing
  const timeLockExpiresAt = Math.floor(Date.now() / 1000) + 2 * 60 * 60; // 2 hours

  console.log(`  Initiator wallet: ${agentWallet.toBase58()}`);
  console.log(`  Mint:             wSOL (${WSOL_MINT.toBase58()})`);
  console.log(`  Amount:           ${amount} lamports (${Number(amount) / 1e9} SOL)`);
  console.log(`  Time-lock:        ${new Date(timeLockExpiresAt * 1000).toISOString()}`);
  console.log(`  Release type:     task (manual release by initiator)`);

  const writeClient = createHoldfastClient({ rpcUrl, signer: initiatorKeypair, agentWallet });

  const pact = await writeClient.escrow.createPact({
    counterparty: counterpartyKeypair.publicKey,
    counterpartyWallet,
    mint: WSOL_MINT,
    amount,
    releaseCondition: { kind: "task", timeLockExpiresAt },
  });

  // escrowId is the 32-byte PDA seed — wrap in PublicKey for subsequent SDK calls
  const escrowId = new PublicKey(Buffer.from(pact.escrowId, "hex"));

  console.log(`\n  ✓ Escrow PDA: ${pact.address}`);
  console.log(`  ✓ Status:     ${statusLabel(pact.status)}`);
  console.log(`  ✓ Explorer:   ${explorerAddr(pact.address)}`);

  // ── Step 4: Deposit (initiator funds the vault) ───────────────────────────

  step(4, "Deposit — initiator funds vault");
  console.log(
    "  (Requires wSOL in your token account — run `spl-token wrap 0.1` if this fails)",
  );

  const depositSig = await writeClient.escrow.depositEscrow(escrowId);
  console.log(`  ✓ Tx: ${explorerTx(depositSig)}`);

  const afterDeposit = await readClient.escrow.getPact(escrowId);
  console.log(`  ✓ Status: ${statusLabel(afterDeposit.status)}`);

  // ── Step 5: Stake beneficiary ─────────────────────────────────────────────

  step(5, "Stake Beneficiary — required before lock");
  console.log(
    "  (Even with zero beneficiary_stake, this call sets the beneficiary_staked flag)",
  );

  // The beneficiary client signs with the counterparty keypair.
  // For a self-pact, this is the same keypair.
  const beneficiaryClient = createHoldfastClient({
    rpcUrl,
    signer: counterpartyKeypair,
    agentWallet: counterpartyWallet,
  });

  const stakeSig = await beneficiaryClient.escrow.stakeBeneficiary(escrowId);
  console.log(`  ✓ Tx: ${explorerTx(stakeSig)}`);

  // ── Step 6: Lock escrow ───────────────────────────────────────────────────

  step(6, "Lock Escrow — both parties commit");
  console.log("  (Initiator and beneficiary co-sign; re-validates reputation thresholds)");

  const lockSig = await writeClient.escrow.lockEscrow(
    escrowId,
    counterpartyKeypair, // beneficiary co-signer; same key for self-pact
    counterpartyWallet,
  );
  console.log(`  ✓ Tx: ${explorerTx(lockSig)}`);

  const afterLock = await readClient.escrow.getPact(escrowId);
  console.log(`  ✓ Status: ${statusLabel(afterLock.status)}`);

  // ── Step 7: Release pact ──────────────────────────────────────────────────

  step(7, "Release Pact — initiator confirms delivery");

  const releaseSig = await writeClient.escrow.releasePact(escrowId);
  console.log(`  ✓ Tx: ${explorerTx(releaseSig)}`);

  const afterRelease = await readClient.escrow.getPact(escrowId);
  const windowEnd =
    afterRelease.disputeWindowEndsAt > 0
      ? new Date(afterRelease.disputeWindowEndsAt * 1000).toUTCString()
      : "n/a";

  console.log(`  ✓ Status:              ${statusLabel(afterRelease.status)}`);
  console.log(`  ✓ Dispute window ends: ${windowEnd}`);
  console.log(
    "  → After the 7-day dispute window, call claimReleased() to finalise funds.",
  );

  // ── Done ──────────────────────────────────────────────────────────────────

  console.log(
    "\n╔══════════════════════════════════════════════════════════════╗\n" +
      "║   Full pact lifecycle complete ✓                            ║\n" +
      "║                                                              ║\n" +
      "║   Next steps:                                                ║\n" +
      "║   • After dispute window: call claimReleased()              ║\n" +
      "║   • Try openDispute() to explore the arbiter flow           ║\n" +
      "║   • See COUNTERPARTY_KEYPAIR_PATH in .env for two-party     ║\n" +
      "║                                                              ║\n" +
      "║   Docs: https://docs.holdfastprotocol.com/sdk               ║\n" +
      "╚══════════════════════════════════════════════════════════════╝\n",
  );
}

main().catch((err: unknown) => {
  console.error("\n[holdfast-quickstart] Error:", err);
  process.exit(1);
});

/**
 * Stress Test — Escrow Lifecycle Under Load
 *
 * Runs N concurrent escrow cycles through the full happy path:
 * initialize -> deposit -> stake -> lock -> release
 *
 * Usage:
 *   STRESS_CONCURRENCY=10 npx ts-node --transpile-only -P tsconfig.json stress-tests/escrow-lifecycle.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { MetricsCollector } from "./lib/metrics";
import {
  setupDevnetContext,
  getConcurrency,
  getOutputDir,
  createSplMint,
  setupParticipant,
  generateEscrowId,
  deriveEscrowPdas,
  getAssociatedTokenAddress,
  confirmAndGetMeta,
  printSummary,
  runWithConcurrency,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  type DevnetContext,
  type FundedParticipant,
} from "./lib/setup";

async function runEscrowCycle(
  ctx: DevnetContext,
  metrics: MetricsCollector,
  initiator: FundedParticipant,
  beneficiary: FundedParticipant,
  arbiter: { walletPda: anchor.web3.PublicKey },
  mint: anchor.web3.PublicKey,
  cycleIndex: number,
): Promise<void> {
  const escrowId = generateEscrowId();
  const { escrowPda, pactPda } = deriveEscrowPdas(escrowId);
  const vaultAta = getAssociatedTokenAddress(mint, escrowPda);
  const timeLockExpiresAt = Math.floor(Date.now() / 1000) + 3600;
  const label = `cycle-${cycleIndex}`;

  // 1. initialize_escrow
  await metrics.trackTx(
    "initialize_escrow",
    async () => {
      return ctx.escrowProgram.methods
        .initializeEscrow({
          escrowId,
          beneficiary: beneficiary.keypair.publicKey,
          arbiter: ctx.payer.publicKey,
          escrowAmount: new anchor.BN(1_000_000),
          initiatorStake: new anchor.BN(100_000),
          beneficiaryStake: new anchor.BN(100_000),
          timeLockExpiresAt: new anchor.BN(timeLockExpiresAt),
          deliverablesHash: Array(32).fill(1),
          deliverablesUri: Array(128).fill(0),
          autoReleaseOnExpiry: false,
          slashLoserStake: false,
          disputeDeadlineSecs: new anchor.BN(86400),
          initiatorReputationMin: new anchor.BN(0),
          beneficiaryReputationMin: new anchor.BN(0),
          initiatorMinTier: 0,
          initiatorMinPacts: new anchor.BN(0),
          beneficiaryMinTier: 0,
          beneficiaryMinPacts: new anchor.BN(0),
        })
        .accounts({
          initiator: initiator.keypair.publicKey,
          escrowAccount: escrowPda,
          pactRecord: pactPda,
          mint,
          vault: vaultAta,
          initiatorReputation: initiator.repPda,
          initiatorWallet: initiator.walletPda,
          beneficiaryWallet: beneficiary.walletPda,
          arbiterWallet: arbiter.walletPda,
          vaultpactProgram: ctx.holdfastProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([initiator.keypair])
        .rpc();
    },
    (sig) => confirmAndGetMeta(ctx.connection, sig),
  );
  console.log(`  [${label}] initialize_escrow done`);

  // 2. deposit_funds
  await metrics.trackTx(
    "deposit_funds",
    async () => {
      return ctx.escrowProgram.methods
        .depositFunds()
        .accounts({
          initiator: initiator.keypair.publicKey,
          escrowAccount: escrowPda,
          initiatorTokenAccount: initiator.tokenAccount,
          vault: vaultAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([initiator.keypair])
        .rpc();
    },
    (sig) => confirmAndGetMeta(ctx.connection, sig),
  );
  console.log(`  [${label}] deposit_funds done`);

  // 3. stake_beneficiary
  await metrics.trackTx(
    "stake_beneficiary",
    async () => {
      return ctx.escrowProgram.methods
        .stakeBeneficiary()
        .accounts({
          beneficiary: beneficiary.keypair.publicKey,
          escrowAccount: escrowPda,
          pactRecord: pactPda,
          beneficiaryTokenAccount: beneficiary.tokenAccount,
          vault: vaultAta,
          beneficiaryReputation: beneficiary.repPda,
          beneficiaryWallet: beneficiary.walletPda,
          vaultpactProgram: ctx.holdfastProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([beneficiary.keypair])
        .rpc();
    },
    (sig) => confirmAndGetMeta(ctx.connection, sig),
  );
  console.log(`  [${label}] stake_beneficiary done`);

  // 4. lock_escrow
  await metrics.trackTx(
    "lock_escrow",
    async () => {
      return ctx.escrowProgram.methods
        .lockEscrow()
        .accounts({
          initiator: initiator.keypair.publicKey,
          beneficiary: beneficiary.keypair.publicKey,
          escrowAccount: escrowPda,
          pactRecord: pactPda,
          vault: vaultAta,
          initiatorWallet: initiator.walletPda,
          beneficiaryWallet: beneficiary.walletPda,
          arbiterWallet: arbiter.walletPda,
          initiatorReputation: initiator.repPda,
          beneficiaryReputation: beneficiary.repPda,
          vaultpactProgram: ctx.holdfastProgram.programId,
        })
        .signers([initiator.keypair, beneficiary.keypair])
        .rpc();
    },
    (sig) => confirmAndGetMeta(ctx.connection, sig),
  );
  console.log(`  [${label}] lock_escrow done`);

  // 5. release_escrow
  await metrics.trackTx(
    "release_escrow",
    async () => {
      return ctx.escrowProgram.methods
        .releaseEscrow()
        .accounts({
          initiator: initiator.keypair.publicKey,
          escrowAccount: escrowPda,
          pactRecord: pactPda,
          initiatorWallet: initiator.walletPda,
        })
        .signers([initiator.keypair])
        .rpc();
    },
    (sig) => confirmAndGetMeta(ctx.connection, sig),
  );
  console.log(`  [${label}] release_escrow done`);
}

async function main(): Promise<void> {
  const concurrency = getConcurrency();
  console.log(`\nEscrow Lifecycle Stress Test — concurrency: ${concurrency}\n`);

  console.log("Setting up devnet context...");
  const ctx = await setupDevnetContext();
  const metrics = new MetricsCollector("escrow-lifecycle", concurrency);

  console.log("Creating SPL mint...");
  const mintKp = await createSplMint(ctx);
  const mint = mintKp.publicKey;

  console.log(`Provisioning ${concurrency} initiator/beneficiary pairs...`);
  const tokensPerParticipant = 10_000_000;
  const participants: { initiator: FundedParticipant; beneficiary: FundedParticipant }[] = [];

  for (let i = 0; i < concurrency; i++) {
    console.log(`  Setting up pair ${i + 1}/${concurrency}...`);
    const [initiator, beneficiary] = await Promise.all([
      setupParticipant(ctx, mint, tokensPerParticipant),
      setupParticipant(ctx, mint, tokensPerParticipant),
    ]);
    participants.push({ initiator, beneficiary });
  }

  // Use payer as arbiter (already has a wallet on devnet from init-registry)
  const [arbiterWalletPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("agent_wallet")],
    ctx.holdfastProgram.programId,
  );
  // Register payer as arbiter agent
  let arbiter: { walletPda: anchor.web3.PublicKey };
  try {
    const result = await import("./lib/setup").then((m) =>
      m.registerAgentWallet(ctx, ctx.payer),
    );
    arbiter = { walletPda: result.walletPda };
  } catch {
    // If payer already has a wallet from a previous run, derive it differently.
    // For stress tests, we use a fresh keypair as arbiter.
    const arbiterKp = anchor.web3.Keypair.generate();
    await import("./lib/setup").then((m) =>
      m.airdropIfNeeded(ctx, arbiterKp.publicKey),
    );
    const result = await import("./lib/setup").then((m) =>
      m.registerAgentWallet(ctx, arbiterKp),
    );
    arbiter = { walletPda: result.walletPda };
  }

  console.log("\nRunning escrow lifecycle cycles...\n");
  metrics.start();

  const tasks = participants.map(
    ({ initiator, beneficiary }, i) =>
      () =>
        runEscrowCycle(ctx, metrics, initiator, beneficiary, arbiter, mint, i),
  );

  await runWithConcurrency(tasks, concurrency);

  const { dir, summary } = metrics.writeResults(getOutputDir());
  printSummary(summary as unknown as Record<string, unknown>);
  console.log(`Results written to: ${dir}`);
}

main().catch((err) => {
  console.error("Stress test failed:", err);
  process.exit(1);
});

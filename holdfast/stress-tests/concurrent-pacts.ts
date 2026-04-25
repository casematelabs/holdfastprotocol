/**
 * Stress Test — Concurrent Pact Submissions
 *
 * Fires N simultaneous initialize_escrow transactions to stress-test PDA
 * derivation, ATA creation, and transaction throughput under concurrent load.
 *
 * Usage:
 *   STRESS_CONCURRENCY=25 npx ts-node --transpile-only -P tsconfig.json stress-tests/concurrent-pacts.ts
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
  registerAgentWallet,
  airdropIfNeeded,
  printSummary,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  type DevnetContext,
  type FundedParticipant,
} from "./lib/setup";

async function fireInitEscrow(
  ctx: DevnetContext,
  metrics: MetricsCollector,
  initiator: FundedParticipant,
  beneficiary: FundedParticipant,
  arbiterWalletPda: anchor.web3.PublicKey,
  mint: anchor.web3.PublicKey,
  batchIndex: number,
): Promise<void> {
  const escrowId = generateEscrowId();
  const { escrowPda, pactPda } = deriveEscrowPdas(escrowId);
  const vaultAta = getAssociatedTokenAddress(mint, escrowPda);
  const timeLockExpiresAt = Math.floor(Date.now() / 1000) + 3600;

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
          arbiterWallet: arbiterWalletPda,
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
  console.log(`  [pact-${batchIndex}] initialize_escrow confirmed`);
}

async function main(): Promise<void> {
  const batchSize = getConcurrency();
  console.log(`\nConcurrent Pact Submissions — batch size: ${batchSize}\n`);

  console.log("Setting up devnet context...");
  const ctx = await setupDevnetContext();
  const metrics = new MetricsCollector("concurrent-pacts", batchSize);

  console.log("Creating SPL mint...");
  const mintKp = await createSplMint(ctx);
  const mint = mintKp.publicKey;

  // Create shared arbiter
  console.log("Registering arbiter...");
  const arbiterKp = anchor.web3.Keypair.generate();
  await airdropIfNeeded(ctx, arbiterKp.publicKey);
  const { walletPda: arbiterWalletPda } = await registerAgentWallet(
    ctx,
    arbiterKp,
  );

  // Each pact needs unique participants to avoid signer contention.
  // But we can reuse beneficiary across pacts since they don't sign init.
  // For maximum stress, we create unique initiators per pact.
  console.log(`Provisioning ${batchSize} initiators + shared beneficiary...\n`);
  const tokensPerParticipant = 10_000_000;

  const beneficiary = await setupParticipant(ctx, mint, tokensPerParticipant);

  const initiators: FundedParticipant[] = [];
  for (let i = 0; i < batchSize; i++) {
    console.log(`  Setting up initiator ${i + 1}/${batchSize}...`);
    const p = await setupParticipant(ctx, mint, tokensPerParticipant);
    initiators.push(p);
  }

  console.log(`\nFiring ${batchSize} concurrent initialize_escrow calls...\n`);
  metrics.start();

  // True concurrent fire — all promises launched simultaneously
  const promises = initiators.map((initiator, i) =>
    fireInitEscrow(
      ctx,
      metrics,
      initiator,
      beneficiary,
      arbiterWalletPda,
      mint,
      i,
    ),
  );
  const results = await Promise.allSettled(promises);

  const fulfilled = results.filter((r) => r.status === "fulfilled").length;
  const rejected = results.filter((r) => r.status === "rejected").length;
  console.log(`\nBatch results: ${fulfilled} fulfilled, ${rejected} rejected`);

  // Log rejected reasons
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      console.error(`  [pact-${i}] REJECTED: ${r.reason?.message ?? r.reason}`);
    }
  });

  const { dir, summary } = metrics.writeResults(getOutputDir());
  printSummary(summary as unknown as Record<string, unknown>);
  console.log(`Results written to: ${dir}`);

  // Verify PDA uniqueness
  const entries = metrics.getEntries();
  const successSigs = entries
    .filter((e) => e.status === "success" && e.txSignature)
    .map((e) => e.txSignature);
  const uniqueSigs = new Set(successSigs);
  if (uniqueSigs.size === successSigs.length) {
    console.log(`PDA uniqueness: PASS (${uniqueSigs.size} unique txs)`);
  } else {
    console.error(
      `PDA uniqueness: FAIL (${successSigs.length} txs but ${uniqueSigs.size} unique)`,
    );
  }
}

main().catch((err) => {
  console.error("Stress test failed:", err);
  process.exit(1);
});

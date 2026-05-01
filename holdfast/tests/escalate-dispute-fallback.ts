import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { VaultpactEscrow } from "../target/types/vaultpact_escrow";
import { Vaultpact } from "../target/types/vaultpact";
import { assert } from "chai";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

let bankrunMod: any = null;
let anchorBankrunMod: any = null;
try {
  bankrunMod = require("solana-bankrun");
  anchorBankrunMod = require("anchor-bankrun");
} catch (_) {
  // bankrun unavailable on this platform
}

const TOKEN_PROGRAM_ID = new anchor.web3.PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new anchor.web3.PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

function getAssociatedTokenAddress(
  mint: anchor.web3.PublicKey,
  owner: anchor.web3.PublicKey,
): anchor.web3.PublicKey {
  const [ata] = anchor.web3.PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

// ══════════════════════════════════════════════════════════════════════════════
// CAS-171: escalate_dispute fallback path regression tests
// Covers: refund via escalation, DisputeNotEscalated, DisputeAlreadyEscalated
// ══════════════════════════════════════════════════════════════════════════════

(bankrunMod ? describe : describe.skip)("CAS-171: escalate_dispute fallback path regressions (bankrun)", function () {
  this.timeout(120_000);

  const VAULTPACT_ID = new anchor.web3.PublicKey("D6mUa4wGtFyLyJorMfxoKvA9ybohjUSsfw88t66ATxg");
  const ESCROW_ID = new anchor.web3.PublicKey("CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi");

  let context: any;
  let brProvider: any;
  let brEscrow: Program<VaultpactEscrow>;
  let brVaultpact: Program<Vaultpact>;
  let authority: anchor.web3.Keypair;
  let brInitiator: anchor.web3.Keypair;
  let brBeneficiary: anchor.web3.Keypair;
  let brArbiter: anchor.web3.Keypair;
  let brMint: anchor.web3.Keypair;
  let brInitiatorToken: anchor.web3.Keypair;
  let brBeneficiaryToken: anchor.web3.Keypair;
  let brInitiatorWalletPda: anchor.web3.PublicKey;
  let brBeneficiaryWalletPda: anchor.web3.PublicKey;
  let brArbiterWalletPda: anchor.web3.PublicKey;
  let brInitiatorRepPda: anchor.web3.PublicKey;
  let brBeneficiaryRepPda: anchor.web3.PublicKey;

  function fundAccount(pubkey: anchor.web3.PublicKey, lamports = 100_000_000_000) {
    context.setAccount(pubkey, {
      lamports,
      data: Buffer.alloc(0),
      owner: anchor.web3.SystemProgram.programId,
      executable: false,
    });
  }

  function setPrebuiltAccount(
    pubkey: anchor.web3.PublicKey,
    owner: anchor.web3.PublicKey,
    data: Buffer,
    lamports = 10_000_000,
  ) {
    context.setAccount(pubkey, { lamports, data, owner, executable: false });
  }

  async function encodeAgentWallet(fields: {
    authority: anchor.web3.PublicKey;
    pubkeyX: Buffer;
    pubkeyY: Buffer;
    status: number;
    bump: number;
  }): Promise<Buffer> {
    return await brVaultpact.coder.accounts.encode("AgentWallet", {
      authority: fields.authority,
      pubkeyX: Array.from(fields.pubkeyX),
      pubkeyY: Array.from(fields.pubkeyY),
      nonce: new anchor.BN(0),
      registeredAt: new anchor.BN(Math.floor(Date.now() / 1000)),
      status: fields.status,
      keyVersion: 1,
      deregisterDeadline: new anchor.BN(0),
      bump: fields.bump,
    });
  }

  before(async () => {
    authority = anchor.web3.Keypair.generate();

    context = await bankrunMod.startAnchor(".", [], []);
    brProvider = new anchorBankrunMod.BankrunProvider(context);

    brEscrow = new Program<VaultpactEscrow>(
      (anchor.workspace.VaultpactEscrow as Program<VaultpactEscrow>).idl as any,
      brProvider,
    );
    brVaultpact = new Program<Vaultpact>(
      (anchor.workspace.Vaultpact as Program<Vaultpact>).idl as any,
      brProvider,
    );

    brInitiator = anchor.web3.Keypair.generate();
    brBeneficiary = anchor.web3.Keypair.generate();
    brArbiter = anchor.web3.Keypair.generate();

    fundAccount(authority.publicKey);
    fundAccount(brInitiator.publicKey);
    fundAccount(brBeneficiary.publicKey);
    fundAccount(brArbiter.publicKey);

    // Pre-populate AgentWallet PDAs
    const iPubkeyX = Buffer.alloc(32, 0x11);
    const iPubkeyY = Buffer.alloc(32, 0x12);
    const [iWalletPda, iWalletBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("agent_wallet"), iPubkeyX, iPubkeyY], VAULTPACT_ID,
    );
    brInitiatorWalletPda = iWalletPda;

    const bPubkeyX = Buffer.alloc(32, 0x13);
    const bPubkeyY = Buffer.alloc(32, 0x14);
    const [bWalletPda, bWalletBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("agent_wallet"), bPubkeyX, bPubkeyY], VAULTPACT_ID,
    );
    brBeneficiaryWalletPda = bWalletPda;

    const aPubkeyX = Buffer.alloc(32, 0x15);
    const aPubkeyY = Buffer.alloc(32, 0x16);
    const [aWalletPda, aWalletBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("agent_wallet"), aPubkeyX, aPubkeyY], VAULTPACT_ID,
    );
    brArbiterWalletPda = aWalletPda;

    setPrebuiltAccount(brInitiatorWalletPda, VAULTPACT_ID,
      await encodeAgentWallet({ authority: brInitiator.publicKey, pubkeyX: iPubkeyX, pubkeyY: iPubkeyY, status: 0, bump: iWalletBump }));
    setPrebuiltAccount(brBeneficiaryWalletPda, VAULTPACT_ID,
      await encodeAgentWallet({ authority: brBeneficiary.publicKey, pubkeyX: bPubkeyX, pubkeyY: bPubkeyY, status: 0, bump: bWalletBump }));
    setPrebuiltAccount(brArbiterWalletPda, VAULTPACT_ID,
      await encodeAgentWallet({ authority: brArbiter.publicKey, pubkeyX: aPubkeyX, pubkeyY: aPubkeyY, status: 0, bump: aWalletBump }));

    // Initialise ReputationAccount PDAs via on-chain tx
    const [iRepPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("reputation"), brInitiator.publicKey.toBuffer()], VAULTPACT_ID,
    );
    brInitiatorRepPda = iRepPda;
    await brVaultpact.methods.initReputation()
      .accounts({
        reputationAccount: iRepPda,
        agent: brInitiator.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([brInitiator])
      .rpc();

    const [bRepPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("reputation"), brBeneficiary.publicKey.toBuffer()], VAULTPACT_ID,
    );
    brBeneficiaryRepPda = bRepPda;
    await brVaultpact.methods.initReputation()
      .accounts({
        reputationAccount: bRepPda,
        agent: brBeneficiary.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([brBeneficiary])
      .rpc();

    // Pre-populate AttestationRegistry
    const [regPda, regBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("attestation_registry")], VAULTPACT_ID,
    );
    const regData = await brVaultpact.coder.accounts.encode("AttestationRegistry", {
      authority: authority.publicKey,
      agentCount: new anchor.BN(2),
      bump: regBump,
    });
    setPrebuiltAccount(regPda, VAULTPACT_ID, regData);

    // Create SPL Token mint and token accounts
    brMint = anchor.web3.Keypair.generate();
    const mintData = Buffer.alloc(82);
    mintData.writeUInt32LE(1, 0);
    authority.publicKey.toBuffer().copy(mintData, 4);
    mintData.writeBigUInt64LE(0n, 36);
    mintData[44] = 6;
    mintData[45] = 1;
    mintData.writeUInt32LE(0, 46);
    setPrebuiltAccount(brMint.publicKey, TOKEN_PROGRAM_ID, mintData, 1_000_000_000);

    brInitiatorToken = anchor.web3.Keypair.generate();
    brBeneficiaryToken = anchor.web3.Keypair.generate();

    function makeTokenAccountData(mint: anchor.web3.PublicKey, owner: anchor.web3.PublicKey, amount: bigint): Buffer {
      const data = Buffer.alloc(165);
      mint.toBuffer().copy(data, 0);
      owner.toBuffer().copy(data, 32);
      data.writeBigUInt64LE(amount, 64);
      data.writeUInt32LE(0, 72);
      data[108] = 1;
      data.writeUInt32LE(0, 109);
      data.writeBigUInt64LE(0n, 117);
      data.writeUInt32LE(0, 125);
      return data;
    }

    setPrebuiltAccount(brInitiatorToken.publicKey, TOKEN_PROGRAM_ID,
      makeTokenAccountData(brMint.publicKey, brInitiator.publicKey, 10_000_000n), 1_000_000_000);
    setPrebuiltAccount(brBeneficiaryToken.publicKey, TOKEN_PROGRAM_ID,
      makeTokenAccountData(brMint.publicKey, brBeneficiary.publicKey, 10_000_000n), 1_000_000_000);
  });

  // ── Helpers ──────────────────────────────────────────────────────────────

  async function warpClockForward(seconds: number) {
    const currentClock = await context.banksClient.getClock();
    const newTimestamp = currentClock.unixTimestamp + BigInt(seconds);
    context.setClock(new bankrunMod.Clock(
      currentClock.slot,
      currentClock.epochStartTimestamp,
      currentClock.epoch,
      currentClock.leaderScheduleEpoch,
      newTimestamp,
    ));
  }

  function getDiag(err: any): string {
    return (
      ((err.logs as string[] | undefined)?.join(" ") ?? "") +
      " " +
      (err.message ?? "")
    );
  }

  async function buildDisputedEscrow(opts: {
    disputeDeadlineSecs?: number;
    escrowAmount?: number;
  } = {}): Promise<{
    escrowPda: anchor.web3.PublicKey;
    pactPda: anchor.web3.PublicKey;
    disputePda: anchor.web3.PublicKey;
    vaultAta: anchor.web3.PublicKey;
  }> {
    const escrowId = Array.from(crypto.randomBytes(32));
    const idBuffer = Buffer.from(escrowId);
    const [escrowPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), idBuffer], ESCROW_ID,
    );
    const [pactPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pact"), idBuffer], ESCROW_ID,
    );
    const [disputePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("dispute"), idBuffer], ESCROW_ID,
    );
    const vaultAta = getAssociatedTokenAddress(brMint.publicKey, escrowPda);

    const currentClock = await context.banksClient.getClock();
    const now = Number(currentClock.unixTimestamp);
    const timeLockExpiresAt = now + 7 * 24 * 3600;

    await brEscrow.methods.initializeEscrow({
      escrowId, beneficiary: brBeneficiary.publicKey, arbiter: brArbiter.publicKey,
      escrowAmount: new anchor.BN(opts.escrowAmount ?? 100_000), initiatorStake: new anchor.BN(0),
      beneficiaryStake: new anchor.BN(0),
      timeLockExpiresAt: new anchor.BN(timeLockExpiresAt),
      deliverablesHash: Array(32).fill(0), deliverablesUri: Array(128).fill(0),
      autoReleaseOnExpiry: false, slashLoserStake: false,
      disputeDeadlineSecs: new anchor.BN(opts.disputeDeadlineSecs ?? 3600),
      initiatorReputationMin: new anchor.BN(0), beneficiaryReputationMin: new anchor.BN(0),
      initiatorMinTier: 0, initiatorMinPacts: new anchor.BN(0),
      beneficiaryMinTier: 0, beneficiaryMinPacts: new anchor.BN(0),
    }).accounts({
      initiator: brInitiator.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      mint: brMint.publicKey, vault: vaultAta, initiatorReputation: brInitiatorRepPda,
      initiatorWallet: brInitiatorWalletPda, beneficiaryWallet: brBeneficiaryWalletPda,
      arbiterWallet: brArbiterWalletPda,
      vaultpactProgram: brVaultpact.programId, tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([brInitiator]).rpc();

    await brEscrow.methods.depositFunds().accounts({
      initiator: brInitiator.publicKey, escrowAccount: escrowPda,
      initiatorTokenAccount: brInitiatorToken.publicKey,
      vault: vaultAta, tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([brInitiator]).rpc();

    await brEscrow.methods.stakeBeneficiary().accounts({
      beneficiary: brBeneficiary.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      beneficiaryTokenAccount: brBeneficiaryToken.publicKey,
      vault: vaultAta, beneficiaryReputation: brBeneficiaryRepPda,
      beneficiaryWallet: brBeneficiaryWalletPda,
      vaultpactProgram: brVaultpact.programId, tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([brBeneficiary]).rpc();

    await brEscrow.methods.lockEscrow().accounts({
      initiator: brInitiator.publicKey, beneficiary: brBeneficiary.publicKey,
      escrowAccount: escrowPda, vault: vaultAta,
      initiatorWallet: brInitiatorWalletPda, beneficiaryWallet: brBeneficiaryWalletPda,
      arbiterWallet: brArbiterWalletPda,
      pactRecord: pactPda, initiatorReputation: brInitiatorRepPda, beneficiaryReputation: brBeneficiaryRepPda,
      vaultpactProgram: brVaultpact.programId,
    }).signers([brInitiator, brBeneficiary]).rpc();

    await brEscrow.methods.raiseDispute({
      evidenceHash: Array(32).fill(0xCC),
      evidenceUri: Array(128).fill(0),
    }).accounts({
      raiser: brInitiator.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      disputeRecord: disputePda, systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([brInitiator]).rpc();

    return { escrowPda, pactPda, disputePda, vaultAta };
  }

  // ── 1. Refund fallback happy path ───────────────────────────────────────
  // Full flow: Disputed → escalate → warp past grace period → refund succeeds

  it("refund succeeds via escalation fallback path (full flow)", async () => {
    const { escrowPda, disputePda, vaultAta } = await buildDisputedEscrow({
      disputeDeadlineSecs: 3600,
      escrowAmount: 250_000,
    });

    const iBalBefore = Number(
      (await brProvider.connection.getTokenAccountBalance(brInitiatorToken.publicKey)).value.amount,
    );

    // Warp past resolution deadline (dispute_deadline_secs = 3600)
    await warpClockForward(3601);

    // Escalate
    await brEscrow.methods.escalateDispute().accounts({
      escalator: brInitiator.publicKey, escrowAccount: escrowPda,
      disputeRecord: disputePda,
    }).signers([brInitiator]).rpc();

    const dispute = await brEscrow.account.disputeRecord.fetch(disputePda);
    assert.isAbove(dispute.escalatedAt.toNumber(), 0, "escalated_at must be set");
    assert.isAbove(dispute.escalationDeadline.toNumber(), dispute.escalatedAt.toNumber(),
      "escalation_deadline must be after escalated_at");

    // Warp past 7-day escalation grace period
    await warpClockForward(7 * 24 * 3600 + 1);

    // Refund via crank
    await brEscrow.methods.refund().accounts({
      crank: authority.publicKey, escrowAccount: escrowPda,
      vault: vaultAta, initiatorTokenAccount: brInitiatorToken.publicKey,
      beneficiaryTokenAccount: brBeneficiaryToken.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
      disputeRecord: disputePda,
    }).signers([authority]).rpc();

    const escrow = await brEscrow.account.escrowAccount.fetch(escrowPda);
    assert.deepEqual(escrow.status, { refunded: {} }, "escrow must be in Refunded status");
    assert.isAbove(escrow.resolvedAt.toNumber(), 0, "resolved_at must be set");

    const iBalAfter = Number(
      (await brProvider.connection.getTokenAccountBalance(brInitiatorToken.publicKey)).value.amount,
    );
    assert.isAbove(iBalAfter, iBalBefore, "initiator must receive refund");
  });

  // ── 2. Beneficiary can escalate (not just initiator) ────────────────────

  it("beneficiary can escalate dispute and trigger fallback refund", async () => {
    const { escrowPda, disputePda, vaultAta } = await buildDisputedEscrow({
      disputeDeadlineSecs: 3600,
    });

    await warpClockForward(3601);

    // Beneficiary escalates (not initiator)
    await brEscrow.methods.escalateDispute().accounts({
      escalator: brBeneficiary.publicKey, escrowAccount: escrowPda,
      disputeRecord: disputePda,
    }).signers([brBeneficiary]).rpc();

    const dispute = await brEscrow.account.disputeRecord.fetch(disputePda);
    assert.isAbove(dispute.escalatedAt.toNumber(), 0,
      "beneficiary must be able to escalate");
  });

  // ── 3. DisputeNotEscalated — refund without escalation ──────────────────

  it("refund on disputed escrow without escalation → DisputeNotEscalated", async () => {
    const { escrowPda, disputePda, vaultAta } = await buildDisputedEscrow({
      disputeDeadlineSecs: 3600,
    });

    // Warp far into the future — but never called escalate_dispute
    await warpClockForward(30 * 24 * 3600);

    try {
      await brEscrow.methods.refund().accounts({
        crank: authority.publicKey, escrowAccount: escrowPda,
        vault: vaultAta, initiatorTokenAccount: brInitiatorToken.publicKey,
        beneficiaryTokenAccount: brBeneficiaryToken.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        disputeRecord: disputePda,
      }).signers([authority]).rpc();
      assert.fail("expected DisputeNotEscalated");
    } catch (err: any) {
      if (err.message?.includes("expected DisputeNotEscalated")) throw err;
      assert.include(getDiag(err), "DisputeNotEscalated",
        "refund must require escalation before fallback refund is available");
    }
  });

  // ── 4. DisputeAlreadyEscalated — double escalation rejected ─────────────

  it("second escalate_dispute call → DisputeAlreadyEscalated", async () => {
    const { escrowPda, disputePda } = await buildDisputedEscrow({
      disputeDeadlineSecs: 3600,
    });

    await warpClockForward(3601);

    // First escalation succeeds
    await brEscrow.methods.escalateDispute().accounts({
      escalator: brInitiator.publicKey, escrowAccount: escrowPda,
      disputeRecord: disputePda,
    }).signers([brInitiator]).rpc();

    const dispute = await brEscrow.account.disputeRecord.fetch(disputePda);
    assert.isAbove(dispute.escalatedAt.toNumber(), 0, "precondition: escalated_at is set");

    // Second escalation must fail
    try {
      await brEscrow.methods.escalateDispute().accounts({
        escalator: brInitiator.publicKey, escrowAccount: escrowPda,
        disputeRecord: disputePda,
      }).signers([brInitiator]).rpc();
      assert.fail("expected DisputeAlreadyEscalated");
    } catch (err: any) {
      if (err.message?.includes("expected DisputeAlreadyEscalated")) throw err;
      assert.include(getDiag(err), "DisputeAlreadyEscalated",
        "re-escalation must be rejected");
    }
  });

  // ── 5. EscalationGracePeriodNotPassed — refund too early ────────────────

  it("refund during escalation grace period → EscalationGracePeriodNotPassed", async () => {
    const { escrowPda, disputePda, vaultAta } = await buildDisputedEscrow({
      disputeDeadlineSecs: 3600,
    });

    await warpClockForward(3601);

    await brEscrow.methods.escalateDispute().accounts({
      escalator: brInitiator.publicKey, escrowAccount: escrowPda,
      disputeRecord: disputePda,
    }).signers([brInitiator]).rpc();

    // Warp 3 days — still within 7-day grace period
    await warpClockForward(3 * 24 * 3600);

    try {
      await brEscrow.methods.refund().accounts({
        crank: authority.publicKey, escrowAccount: escrowPda,
        vault: vaultAta, initiatorTokenAccount: brInitiatorToken.publicKey,
        beneficiaryTokenAccount: brBeneficiaryToken.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        disputeRecord: disputePda,
      }).signers([authority]).rpc();
      assert.fail("expected EscalationGracePeriodNotPassed");
    } catch (err: any) {
      if (err.message?.includes("expected EscalationGracePeriodNotPassed")) throw err;
      assert.include(getDiag(err), "EscalationGracePeriodNotPassed",
        "refund must wait for full grace period");
    }
  });

  // ── 6. Boundary: refund exactly at escalation_deadline (strict > check) ─

  it("refund exactly at escalation_deadline fails (strict > required)", async () => {
    const { escrowPda, disputePda, vaultAta } = await buildDisputedEscrow({
      disputeDeadlineSecs: 3600,
    });

    await warpClockForward(3601);

    await brEscrow.methods.escalateDispute().accounts({
      escalator: brInitiator.publicKey, escrowAccount: escrowPda,
      disputeRecord: disputePda,
    }).signers([brInitiator]).rpc();

    const dispute = await brEscrow.account.disputeRecord.fetch(disputePda);
    const currentClock = await context.banksClient.getClock();
    const secsToDeadline = Number(dispute.escalationDeadline) - Number(currentClock.unixTimestamp);

    // Warp exactly to the deadline (not past it)
    await warpClockForward(secsToDeadline);

    try {
      await brEscrow.methods.refund().accounts({
        crank: authority.publicKey, escrowAccount: escrowPda,
        vault: vaultAta, initiatorTokenAccount: brInitiatorToken.publicKey,
        beneficiaryTokenAccount: brBeneficiaryToken.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        disputeRecord: disputePda,
      }).signers([authority]).rpc();
      assert.fail("expected EscalationGracePeriodNotPassed");
    } catch (err: any) {
      if (err.message?.includes("expected EscalationGracePeriodNotPassed")) throw err;
      assert.include(getDiag(err), "EscalationGracePeriodNotPassed",
        "refund.rs uses strict > check; exactly-at-deadline must fail");
    }
  });

  // ── 7. Non-participant cannot escalate ──────────────────────────────────

  it("arbiter (non-participant) cannot escalate → NotParticipant", async () => {
    const { escrowPda, disputePda } = await buildDisputedEscrow({
      disputeDeadlineSecs: 3600,
    });

    await warpClockForward(3601);

    try {
      await brEscrow.methods.escalateDispute().accounts({
        escalator: brArbiter.publicKey, escrowAccount: escrowPda,
        disputeRecord: disputePda,
      }).signers([brArbiter]).rpc();
      assert.fail("expected NotParticipant");
    } catch (err: any) {
      if (err.message?.includes("expected NotParticipant")) throw err;
      assert.include(getDiag(err), "NotParticipant",
        "only initiator or beneficiary may escalate");
    }
  });

  // ── 8. Escalation before resolution deadline → ResolutionDeadlineNotPassed

  it("escalate before resolution_deadline → ResolutionDeadlineNotPassed", async () => {
    const { escrowPda, disputePda } = await buildDisputedEscrow({
      disputeDeadlineSecs: 86400,
    });

    // Warp only 1 hour — well within 24h deadline
    await warpClockForward(3600);

    try {
      await brEscrow.methods.escalateDispute().accounts({
        escalator: brInitiator.publicKey, escrowAccount: escrowPda,
        disputeRecord: disputePda,
      }).signers([brInitiator]).rpc();
      assert.fail("expected ResolutionDeadlineNotPassed");
    } catch (err: any) {
      if (err.message?.includes("expected ResolutionDeadlineNotPassed")) throw err;
      assert.include(getDiag(err), "ResolutionDeadlineNotPassed",
        "escalation must wait for resolution deadline");
    }
  });
});

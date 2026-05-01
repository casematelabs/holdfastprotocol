// =====================================================================
//
//  spl-token-errors.ts  —  SPL token error scenario tests  (CAS-149)
//
//  Covers error paths triggered by invalid or frozen SPL token accounts
//  in the Holdfast Protocol escrow program:
//
//  Suite 1 — deposit_funds token account errors
//    T-SPL-1: owner mismatch → UnauthorizedTokenAccount
//    T-SPL-2: mint mismatch  → UnauthorizedTokenAccount
//    T-SPL-3: frozen initiator_token_account → SPL AccountFrozen (0x11)
//
//  Suite 2 — stake_beneficiary token account errors
//    T-SPL-4: owner mismatch → UnauthorizedTokenAccount
//    T-SPL-5: mint mismatch  → UnauthorizedTokenAccount
//    T-SPL-6: frozen beneficiary_token_account → SPL AccountFrozen (0x11)
//
//  Suite 3 — claim_released initiator_token_account constraint errors
//    T-SPL-7: owner mismatch → UnauthorizedTokenAccount
//    T-SPL-8: mint mismatch  → UnauthorizedTokenAccount
//    (Anchor constraint fires before dispute-window time check; no time-warp needed)
//
//  Suite 4 — refund token account constraint errors
//    T-SPL-9:  initiator owner mismatch  → UnauthorizedTokenAccount
//    T-SPL-10: initiator mint mismatch   → UnauthorizedTokenAccount
//    T-SPL-11: beneficiary owner mismatch → UnauthorizedTokenAccount
//    T-SPL-12: beneficiary mint mismatch  → UnauthorizedTokenAccount
//    (Constraints fire before timelock-expiry check; no time-warp needed)
//
//  Suite 5 — Frozen destination accounts during settlement (bankrun)
//    T-SPL-13: claim_released with frozen beneficiary_token_account → 0x11
//    T-SPL-14: refund with frozen initiator_token_account → 0x11
//    T-SPL-15: refund with frozen beneficiary_token_account → 0x11
//    (Skipped when bankrun unavailable — Windows)
//
// =====================================================================

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { VaultpactEscrow } from "../target/types/vaultpact_escrow";
import { Vaultpact } from "../target/types/vaultpact";
import { assert } from "chai";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { p256 } = require("../oracle/node_modules/@noble/curves/nist.js");

let bankrunMod: any = null;
let anchorBankrunMod: any = null;
try {
  bankrunMod = require("solana-bankrun");
  anchorBankrunMod = require("anchor-bankrun");
} catch (_) {
  // bankrun unavailable on this platform
}

// ── Constants ─────────────────────────────────────────────────────────

const TOKEN_PROGRAM_ID = new anchor.web3.PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new anchor.web3.PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
const SYSVAR_INSTRUCTIONS = new anchor.web3.PublicKey(
  "Sysvar1nstructions1111111111111111111111111",
);
const SECP256R1_PROGRAM_ID = new anchor.web3.PublicKey(
  Buffer.from([
    6, 146, 13, 236, 47, 234, 113, 181, 183, 35, 129, 77, 116, 45, 169, 3,
    28, 131, 231, 95, 219, 121, 93, 86, 142, 117, 71, 128, 32, 0, 0, 0,
  ]),
);

const MINT_SIZE = 82;
const TOKEN_ACCOUNT_SIZE = 165;

// SPL Token AccountFrozen error (error index 17 = 0x11)
const SPL_ACCOUNT_FROZEN_HEX = "0x11";

// ── Raw SPL Token instruction builders ────────────────────────────────

function splInitMint2Ix(
  mint: anchor.web3.PublicKey,
  decimals: number,
  mintAuthority: anchor.web3.PublicKey,
  freezeAuthority: anchor.web3.PublicKey | null,
): anchor.web3.TransactionInstruction {
  const data = Buffer.alloc(67);
  data[0] = 20; // InitializeMint2
  data[1] = decimals;
  mintAuthority.toBuffer().copy(data, 2);
  if (freezeAuthority) {
    data[34] = 1;
    freezeAuthority.toBuffer().copy(data, 35);
  }
  return new anchor.web3.TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [{ pubkey: mint, isSigner: false, isWritable: true }],
    data,
  });
}

function splInitAccount3Ix(
  account: anchor.web3.PublicKey,
  mint: anchor.web3.PublicKey,
  owner: anchor.web3.PublicKey,
): anchor.web3.TransactionInstruction {
  const data = Buffer.alloc(33);
  data[0] = 18; // InitializeAccount3
  owner.toBuffer().copy(data, 1);
  return new anchor.web3.TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function splMintToIx(
  mint: anchor.web3.PublicKey,
  destination: anchor.web3.PublicKey,
  authority: anchor.web3.PublicKey,
  amount: number,
): anchor.web3.TransactionInstruction {
  const data = Buffer.alloc(9);
  data[0] = 7; // MintTo
  data.writeBigUInt64LE(BigInt(amount), 1);
  return new anchor.web3.TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data,
  });
}

function splFreezeAccountIx(
  account: anchor.web3.PublicKey,
  mint: anchor.web3.PublicKey,
  freezeAuthority: anchor.web3.PublicKey,
): anchor.web3.TransactionInstruction {
  const data = Buffer.alloc(1);
  data[0] = 10; // FreezeAccount
  return new anchor.web3.TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: freezeAuthority, isSigner: true, isWritable: false },
    ],
    data,
  });
}

function splThawAccountIx(
  account: anchor.web3.PublicKey,
  mint: anchor.web3.PublicKey,
  freezeAuthority: anchor.web3.PublicKey,
): anchor.web3.TransactionInstruction {
  const data = Buffer.alloc(1);
  data[0] = 11; // ThawAccount
  return new anchor.web3.TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: freezeAuthority, isSigner: true, isWritable: false },
    ],
    data,
  });
}

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

// ── Secp256r1 helpers ─────────────────────────────────────────────────

function buildSecp256r1Instruction(
  sig: Uint8Array,
  compressedPubkey: Uint8Array,
  message: Buffer,
): anchor.web3.TransactionInstruction {
  const SIG_OFFSET = 16;
  const PUBKEY_OFFSET = SIG_OFFSET + 64;
  const MSG_OFFSET = PUBKEY_OFFSET + 33;
  const MSG_SIZE = message.length;
  const data = Buffer.alloc(MSG_OFFSET + MSG_SIZE);
  data[0] = 1;
  data[1] = 0;
  data.writeUInt16LE(SIG_OFFSET, 2);
  data.writeUInt16LE(0xffff, 4);
  data.writeUInt16LE(PUBKEY_OFFSET, 6);
  data.writeUInt16LE(0xffff, 8);
  data.writeUInt16LE(MSG_OFFSET, 10);
  data.writeUInt16LE(MSG_SIZE, 12);
  data.writeUInt16LE(0xffff, 14);
  Buffer.from(sig).copy(data, SIG_OFFSET);
  Buffer.from(compressedPubkey).copy(data, PUBKEY_OFFSET);
  message.copy(data, MSG_OFFSET);
  return new anchor.web3.TransactionInstruction({
    programId: SECP256R1_PROGRAM_ID,
    keys: [],
    data,
  });
}

function buildRegistrationPreimage(
  authority: anchor.web3.PublicKey,
  pubkeyX: Buffer,
  pubkeyY: Buffer,
): Buffer {
  return Buffer.concat([
    Buffer.from("vaultpact:register_agent_wallet:v1:"),
    authority.toBuffer(),
    pubkeyX,
    pubkeyY,
  ]);
}

// ── Main test suite ───────────────────────────────────────────────────

describe("SPL token error scenarios — escrow (CAS-149)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const escrowProgram = anchor.workspace.VaultpactEscrow as Program<VaultpactEscrow>;
  const vaultpactProgram = anchor.workspace.Vaultpact as Program<Vaultpact>;

  const [registryPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("attestation_registry")],
    vaultpactProgram.programId,
  );
  const [escrowAuthority] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vp_escrow_authority")],
    escrowProgram.programId,
  );

  // ── Shared test state ─────────────────────────────────────────────

  // Primary actors
  let initiator: anchor.web3.Keypair;
  let beneficiary: anchor.web3.Keypair;
  let arbiter: anchor.web3.Keypair;

  // Mint with freeze authority so we can freeze individual accounts
  let freezableMint: anchor.web3.Keypair;
  let freezableMintPubkey: anchor.web3.PublicKey;

  // A second mint (no freeze authority) for mint-mismatch tests
  let altMint: anchor.web3.Keypair;
  let altMintPubkey: anchor.web3.PublicKey;

  // Token accounts
  let initiatorTokenAccount: anchor.web3.Keypair;
  let beneficiaryTokenAccount: anchor.web3.Keypair;

  // Alt-mint token accounts (wrong mint, correct owner)
  let initiatorAltMintAccount: anchor.web3.Keypair;
  let beneficiaryAltMintAccount: anchor.web3.Keypair;

  // Wrong-owner token accounts (correct mint, wrong owner — owned by strangerKeypair)
  let strangerKeypair: anchor.web3.Keypair;
  let strangerOwnedInitiatorMintAccount: anchor.web3.Keypair; // mint=freezableMint, owner=stranger
  let strangerOwnedBeneficiaryMintAccount: anchor.web3.Keypair; // mint=freezableMint, owner=stranger

  let initiatorWalletPda: anchor.web3.PublicKey;
  let beneficiaryWalletPda: anchor.web3.PublicKey;
  let arbiterWalletPda: anchor.web3.PublicKey;
  let initiatorRepPda: anchor.web3.PublicKey;
  let beneficiaryRepPda: anchor.web3.PublicKey;

  // ── Helpers ─────────────────────────────────────────────────────

  async function airdrop(pubkey: anchor.web3.PublicKey, lamports = 10 * anchor.web3.LAMPORTS_PER_SOL) {
    const sig = await provider.connection.requestAirdrop(pubkey, lamports);
    await provider.connection.confirmTransaction(sig);
  }

  async function createSplMint(
    mintAuthority: anchor.web3.PublicKey,
    freezeAuthority: anchor.web3.PublicKey | null = null,
  ): Promise<anchor.web3.Keypair> {
    const mint = anchor.web3.Keypair.generate();
    const rent = await provider.connection.getMinimumBalanceForRentExemption(MINT_SIZE);
    const tx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.createAccount({
        fromPubkey: provider.wallet.publicKey,
        newAccountPubkey: mint.publicKey,
        space: MINT_SIZE,
        lamports: rent,
        programId: TOKEN_PROGRAM_ID,
      }),
      splInitMint2Ix(mint.publicKey, 6, mintAuthority, freezeAuthority),
    );
    await provider.sendAndConfirm(tx, [mint]);
    return mint;
  }

  async function createTokenAccount(
    mint: anchor.web3.PublicKey,
    owner: anchor.web3.PublicKey,
  ): Promise<anchor.web3.Keypair> {
    const account = anchor.web3.Keypair.generate();
    const rent = await provider.connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE);
    const tx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.createAccount({
        fromPubkey: provider.wallet.publicKey,
        newAccountPubkey: account.publicKey,
        space: TOKEN_ACCOUNT_SIZE,
        lamports: rent,
        programId: TOKEN_PROGRAM_ID,
      }),
      splInitAccount3Ix(account.publicKey, mint, owner),
    );
    await provider.sendAndConfirm(tx, [account]);
    return account;
  }

  async function mintTokens(
    mint: anchor.web3.PublicKey,
    destination: anchor.web3.PublicKey,
    amount: number,
  ) {
    const walletKeypair = anchor.web3.Keypair.fromSecretKey(
      (provider.wallet as anchor.Wallet).payer.secretKey,
    );
    const tx = new anchor.web3.Transaction().add(
      splMintToIx(mint, destination, walletKeypair.publicKey, amount),
    );
    await provider.sendAndConfirm(tx, [walletKeypair]);
  }

  async function freezeAccount(
    account: anchor.web3.PublicKey,
    mint: anchor.web3.PublicKey,
  ) {
    const walletKeypair = anchor.web3.Keypair.fromSecretKey(
      (provider.wallet as anchor.Wallet).payer.secretKey,
    );
    const tx = new anchor.web3.Transaction().add(
      splFreezeAccountIx(account, mint, walletKeypair.publicKey),
    );
    await provider.sendAndConfirm(tx, [walletKeypair]);
  }

  async function thawAccount(
    account: anchor.web3.PublicKey,
    mint: anchor.web3.PublicKey,
  ) {
    const walletKeypair = anchor.web3.Keypair.fromSecretKey(
      (provider.wallet as anchor.Wallet).payer.secretKey,
    );
    const tx = new anchor.web3.Transaction().add(
      splThawAccountIx(account, mint, walletKeypair.publicKey),
    );
    await provider.sendAndConfirm(tx, [walletKeypair]);
  }

  async function registerAgentWallet(authority: anchor.web3.Keypair): Promise<{
    walletPda: anchor.web3.PublicKey;
  }> {
    const privKey = p256.utils.randomPrivateKey();
    const uncompressed: Uint8Array = p256.getPublicKey(privKey, false);
    const compressedPubkey: Uint8Array = p256.getPublicKey(privKey, true);
    const pubkeyX = Buffer.from(uncompressed.slice(1, 33));
    const pubkeyY = Buffer.from(uncompressed.slice(33, 65));

    const [walletPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("agent_wallet"), pubkeyX, pubkeyY],
      vaultpactProgram.programId,
    );

    const preimage = buildRegistrationPreimage(authority.publicKey, pubkeyX, pubkeyY);
    const preimageHash = crypto.createHash("sha256").update(preimage).digest();
    const sigBytes = p256.sign(preimageHash, privKey).toCompactRawBytes();

    const secp256r1Ix = buildSecp256r1Instruction(sigBytes, compressedPubkey, preimageHash);
    const registerIx = await vaultpactProgram.methods
      .registerAgentWallet(Array.from(pubkeyX) as number[], Array.from(pubkeyY) as number[])
      .accounts({
        agentWallet: walletPda,
        attestationRegistry: registryPda,
        payer: authority.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        instructions: SYSVAR_INSTRUCTIONS,
      })
      .signers([authority])
      .instruction();

    const tx = new anchor.web3.Transaction().add(secp256r1Ix, registerIx);
    await provider.sendAndConfirm(tx, [authority]);
    return { walletPda };
  }

  async function initReputation(agent: anchor.web3.Keypair): Promise<anchor.web3.PublicKey> {
    const [repPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("reputation"), agent.publicKey.toBuffer()],
      vaultpactProgram.programId,
    );
    await vaultpactProgram.methods
      .initReputation()
      .accounts({
        reputationAccount: repPda,
        agent: agent.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([agent])
      .rpc();
    return repPda;
  }

  function generateEscrowId(): number[] {
    return Array.from(crypto.randomBytes(32));
  }

  function deriveEscrowPdas(escrowId: number[]) {
    const idBuffer = Buffer.from(escrowId);
    const [escrowPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), idBuffer], escrowProgram.programId,
    );
    const [pactPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pact"), idBuffer], escrowProgram.programId,
    );
    const [disputePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("dispute"), idBuffer], escrowProgram.programId,
    );
    return { escrowPda, pactPda, disputePda };
  }

  function getDiag(err: any): string {
    return (
      ((err.logs as string[] | undefined)?.join(" ") ?? "") +
      " " +
      (err.message ?? "")
    );
  }

  // Build an escrow initialized with default params (Pending state).
  async function buildInitializedEscrow(): Promise<{
    escrowId: number[];
    escrowPda: anchor.web3.PublicKey;
    pactPda: anchor.web3.PublicKey;
    vaultAta: anchor.web3.PublicKey;
  }> {
    const escrowId = generateEscrowId();
    const { escrowPda, pactPda } = deriveEscrowPdas(escrowId);
    const vaultAta = getAssociatedTokenAddress(freezableMintPubkey, escrowPda);

    await escrowProgram.methods.initializeEscrow({
      escrowId,
      beneficiary: beneficiary.publicKey,
      arbiter: arbiter.publicKey,
      escrowAmount: new anchor.BN(100_000),
      initiatorStake: new anchor.BN(0),
      beneficiaryStake: new anchor.BN(0),
      timeLockExpiresAt: new anchor.BN(Math.floor(Date.now() / 1000) + 3600),
      deliverablesHash: Array(32).fill(0),
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
    }).accounts({
      initiator: initiator.publicKey,
      escrowAccount: escrowPda,
      pactRecord: pactPda,
      mint: freezableMintPubkey,
      vault: vaultAta,
      initiatorReputation: initiatorRepPda,
      initiatorWallet: initiatorWalletPda,
      beneficiaryWallet: beneficiaryWalletPda,
      arbiterWallet: arbiterWalletPda,
      vaultpactProgram: vaultpactProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([initiator]).rpc();

    return { escrowId, escrowPda, pactPda, vaultAta };
  }

  // Build an escrow through to Funded state (deposit done, stake not yet).
  async function buildFundedEscrow(): Promise<{
    escrowId: number[];
    escrowPda: anchor.web3.PublicKey;
    pactPda: anchor.web3.PublicKey;
    vaultAta: anchor.web3.PublicKey;
  }> {
    const { escrowId, escrowPda, pactPda, vaultAta } = await buildInitializedEscrow();
    await escrowProgram.methods.depositFunds().accounts({
      initiator: initiator.publicKey,
      escrowAccount: escrowPda,
      initiatorTokenAccount: initiatorTokenAccount.publicKey,
      vault: vaultAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([initiator]).rpc();
    return { escrowId, escrowPda, pactPda, vaultAta };
  }

  // Build an escrow through to Released state (for claim_released constraint tests).
  async function buildReleasedEscrow(): Promise<{
    escrowId: number[];
    escrowPda: anchor.web3.PublicKey;
    pactPda: anchor.web3.PublicKey;
    vaultAta: anchor.web3.PublicKey;
  }> {
    const { escrowId, escrowPda, pactPda, vaultAta } = await buildFundedEscrow();

    await escrowProgram.methods.stakeBeneficiary().accounts({
      beneficiary: beneficiary.publicKey,
      escrowAccount: escrowPda,
      pactRecord: pactPda,
      beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
      vault: vaultAta,
      beneficiaryReputation: beneficiaryRepPda,
      beneficiaryWallet: beneficiaryWalletPda,
      vaultpactProgram: vaultpactProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([beneficiary]).rpc();

    await escrowProgram.methods.lockEscrow().accounts({
      initiator: initiator.publicKey,
      beneficiary: beneficiary.publicKey,
      escrowAccount: escrowPda,
      pactRecord: pactPda,
      vault: vaultAta,
      initiatorWallet: initiatorWalletPda,
      beneficiaryWallet: beneficiaryWalletPda,
      arbiterWallet: arbiterWalletPda,
      initiatorReputation: initiatorRepPda,
      beneficiaryReputation: beneficiaryRepPda,
      vaultpactProgram: vaultpactProgram.programId,
    }).signers([initiator, beneficiary]).rpc();

    await escrowProgram.methods.releaseEscrow().accounts({
      initiator: initiator.publicKey,
      escrowAccount: escrowPda,
      pactRecord: pactPda,
      initiatorWallet: initiatorWalletPda,
    }).signers([initiator]).rpc();

    return { escrowId, escrowPda, pactPda, vaultAta };
  }

  // Build an escrow through to Locked state (for refund constraint tests).
  async function buildLockedEscrow(opts: {
    initiatorStake?: number;
    beneficiaryStake?: number;
  } = {}): Promise<{
    escrowId: number[];
    escrowPda: anchor.web3.PublicKey;
    pactPda: anchor.web3.PublicKey;
    vaultAta: anchor.web3.PublicKey;
  }> {
    const escrowId = generateEscrowId();
    const { escrowPda, pactPda } = deriveEscrowPdas(escrowId);
    const vaultAta = getAssociatedTokenAddress(freezableMintPubkey, escrowPda);

    await escrowProgram.methods.initializeEscrow({
      escrowId,
      beneficiary: beneficiary.publicKey,
      arbiter: arbiter.publicKey,
      escrowAmount: new anchor.BN(100_000),
      initiatorStake: new anchor.BN(opts.initiatorStake ?? 0),
      beneficiaryStake: new anchor.BN(opts.beneficiaryStake ?? 0),
      timeLockExpiresAt: new anchor.BN(Math.floor(Date.now() / 1000) + 3600),
      deliverablesHash: Array(32).fill(0),
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
    }).accounts({
      initiator: initiator.publicKey,
      escrowAccount: escrowPda,
      pactRecord: pactPda,
      mint: freezableMintPubkey,
      vault: vaultAta,
      initiatorReputation: initiatorRepPda,
      initiatorWallet: initiatorWalletPda,
      beneficiaryWallet: beneficiaryWalletPda,
      arbiterWallet: arbiterWalletPda,
      vaultpactProgram: vaultpactProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([initiator]).rpc();

    await escrowProgram.methods.depositFunds().accounts({
      initiator: initiator.publicKey,
      escrowAccount: escrowPda,
      initiatorTokenAccount: initiatorTokenAccount.publicKey,
      vault: vaultAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([initiator]).rpc();

    if ((opts.beneficiaryStake ?? 0) > 0) {
      await escrowProgram.methods.stakeBeneficiary().accounts({
        beneficiary: beneficiary.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
        vault: vaultAta,
        beneficiaryReputation: beneficiaryRepPda,
        beneficiaryWallet: beneficiaryWalletPda,
        vaultpactProgram: vaultpactProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([beneficiary]).rpc();
    } else {
      // zero-stake beneficiary: stakeBeneficiary is still required (sets beneficiary_staked flag)
      await escrowProgram.methods.stakeBeneficiary().accounts({
        beneficiary: beneficiary.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
        vault: vaultAta,
        beneficiaryReputation: beneficiaryRepPda,
        beneficiaryWallet: beneficiaryWalletPda,
        vaultpactProgram: vaultpactProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([beneficiary]).rpc();
    }

    await escrowProgram.methods.lockEscrow().accounts({
      initiator: initiator.publicKey,
      beneficiary: beneficiary.publicKey,
      escrowAccount: escrowPda,
      pactRecord: pactPda,
      vault: vaultAta,
      initiatorWallet: initiatorWalletPda,
      beneficiaryWallet: beneficiaryWalletPda,
      arbiterWallet: arbiterWalletPda,
      initiatorReputation: initiatorRepPda,
      beneficiaryReputation: beneficiaryRepPda,
      vaultpactProgram: vaultpactProgram.programId,
    }).signers([initiator, beneficiary]).rpc();

    return { escrowId, escrowPda, pactPda, vaultAta };
  }

  // ── Setup ────────────────────────────────────────────────────────

  before(async () => {
    initiator = anchor.web3.Keypair.generate();
    beneficiary = anchor.web3.Keypair.generate();
    arbiter = anchor.web3.Keypair.generate();
    strangerKeypair = anchor.web3.Keypair.generate();

    await Promise.all([
      airdrop(initiator.publicKey),
      airdrop(beneficiary.publicKey),
      airdrop(arbiter.publicKey),
      airdrop(strangerKeypair.publicKey),
    ]);

    // Ensure attestation registry exists (idempotent)
    try {
      await vaultpactProgram.methods
        .initializeRegistry()
        .accounts({
          attestationRegistry: registryPda,
          authority: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          escrowProgram: escrowProgram.programId,
        })
        .rpc();
    } catch (err: any) {
      if (!err.message?.includes("already in use")) throw err;
    }

    const [iWallet, bWallet, aWallet] = await Promise.all([
      registerAgentWallet(initiator),
      registerAgentWallet(beneficiary),
      registerAgentWallet(arbiter),
    ]);
    initiatorWalletPda = iWallet.walletPda;
    beneficiaryWalletPda = bWallet.walletPda;
    arbiterWalletPda = aWallet.walletPda;

    [initiatorRepPda, beneficiaryRepPda] = await Promise.all([
      initReputation(initiator),
      initReputation(beneficiary),
    ]);

    // Freezable mint: provider wallet is BOTH mint authority and freeze authority
    freezableMint = await createSplMint(
      provider.wallet.publicKey,
      provider.wallet.publicKey,
    );
    freezableMintPubkey = freezableMint.publicKey;

    // Alt mint (no freeze authority) used only for mint-mismatch tests
    altMint = await createSplMint(provider.wallet.publicKey, null);
    altMintPubkey = altMint.publicKey;

    // Correct-owner token accounts on the freezable mint
    initiatorTokenAccount = await createTokenAccount(freezableMintPubkey, initiator.publicKey);
    beneficiaryTokenAccount = await createTokenAccount(freezableMintPubkey, beneficiary.publicKey);

    // Wrong-owner accounts: correct freezable mint, but owned by strangerKeypair
    strangerOwnedInitiatorMintAccount = await createTokenAccount(freezableMintPubkey, strangerKeypair.publicKey);
    strangerOwnedBeneficiaryMintAccount = await createTokenAccount(freezableMintPubkey, strangerKeypair.publicKey);

    // Alt-mint accounts: correct owner but wrong mint
    initiatorAltMintAccount = await createTokenAccount(altMintPubkey, initiator.publicKey);
    beneficiaryAltMintAccount = await createTokenAccount(altMintPubkey, beneficiary.publicKey);

    // Mint plenty of tokens to the primary accounts (initiator needs most for deposits)
    await Promise.all([
      mintTokens(freezableMintPubkey, initiatorTokenAccount.publicKey, 50_000_000),
      mintTokens(freezableMintPubkey, beneficiaryTokenAccount.publicKey, 10_000_000),
    ]);
  });

  // ═══════════════════════════════════════════════════════════════════
  // Suite 1 — deposit_funds token account errors
  // ═══════════════════════════════════════════════════════════════════

  it("T-SPL-1: deposit_funds rejects initiator_token_account with wrong owner (UnauthorizedTokenAccount)", async () => {
    const { escrowPda, vaultAta } = await buildInitializedEscrow();

    try {
      await escrowProgram.methods.depositFunds().accounts({
        initiator: initiator.publicKey,
        escrowAccount: escrowPda,
        initiatorTokenAccount: strangerOwnedInitiatorMintAccount.publicKey,
        vault: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([initiator]).rpc();
      assert.fail("expected UnauthorizedTokenAccount");
    } catch (err: any) {
      if (err.message?.includes("expected UnauthorizedTokenAccount")) throw err;
      assert.include(getDiag(err), "UnauthorizedTokenAccount");
    }
  });

  it("T-SPL-2: deposit_funds rejects initiator_token_account with wrong mint (UnauthorizedTokenAccount)", async () => {
    const { escrowPda, vaultAta } = await buildInitializedEscrow();

    try {
      await escrowProgram.methods.depositFunds().accounts({
        initiator: initiator.publicKey,
        escrowAccount: escrowPda,
        initiatorTokenAccount: initiatorAltMintAccount.publicKey,
        vault: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([initiator]).rpc();
      assert.fail("expected UnauthorizedTokenAccount");
    } catch (err: any) {
      if (err.message?.includes("expected UnauthorizedTokenAccount")) throw err;
      assert.include(getDiag(err), "UnauthorizedTokenAccount");
    }
  });

  it("T-SPL-3: deposit_funds fails with SPL AccountFrozen (0x11) when initiator token account is frozen", async () => {
    const { escrowPda, vaultAta } = await buildInitializedEscrow();

    await freezeAccount(initiatorTokenAccount.publicKey, freezableMintPubkey);
    try {
      await escrowProgram.methods.depositFunds().accounts({
        initiator: initiator.publicKey,
        escrowAccount: escrowPda,
        initiatorTokenAccount: initiatorTokenAccount.publicKey,
        vault: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([initiator]).rpc();
      assert.fail("expected SPL AccountFrozen");
    } catch (err: any) {
      if (err.message?.includes("expected SPL AccountFrozen")) throw err;
      assert.include(getDiag(err), SPL_ACCOUNT_FROZEN_HEX);
    } finally {
      await thawAccount(initiatorTokenAccount.publicKey, freezableMintPubkey);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // Suite 2 — stake_beneficiary token account errors
  // ═══════════════════════════════════════════════════════════════════

  it("T-SPL-4: stake_beneficiary rejects beneficiary_token_account with wrong owner (UnauthorizedTokenAccount)", async () => {
    const { escrowPda, pactPda, vaultAta } = await buildFundedEscrow();

    try {
      await escrowProgram.methods.stakeBeneficiary().accounts({
        beneficiary: beneficiary.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        beneficiaryTokenAccount: strangerOwnedBeneficiaryMintAccount.publicKey,
        vault: vaultAta,
        beneficiaryReputation: beneficiaryRepPda,
        beneficiaryWallet: beneficiaryWalletPda,
        vaultpactProgram: vaultpactProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([beneficiary]).rpc();
      assert.fail("expected UnauthorizedTokenAccount");
    } catch (err: any) {
      if (err.message?.includes("expected UnauthorizedTokenAccount")) throw err;
      assert.include(getDiag(err), "UnauthorizedTokenAccount");
    }
  });

  it("T-SPL-5: stake_beneficiary rejects beneficiary_token_account with wrong mint (UnauthorizedTokenAccount)", async () => {
    const { escrowPda, pactPda, vaultAta } = await buildFundedEscrow();

    try {
      await escrowProgram.methods.stakeBeneficiary().accounts({
        beneficiary: beneficiary.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        beneficiaryTokenAccount: beneficiaryAltMintAccount.publicKey,
        vault: vaultAta,
        beneficiaryReputation: beneficiaryRepPda,
        beneficiaryWallet: beneficiaryWalletPda,
        vaultpactProgram: vaultpactProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([beneficiary]).rpc();
      assert.fail("expected UnauthorizedTokenAccount");
    } catch (err: any) {
      if (err.message?.includes("expected UnauthorizedTokenAccount")) throw err;
      assert.include(getDiag(err), "UnauthorizedTokenAccount");
    }
  });

  it("T-SPL-6: stake_beneficiary fails with SPL AccountFrozen (0x11) when beneficiary token account is frozen", async () => {
    // Build a funded escrow with beneficiary_stake > 0 so the transfer is non-zero.
    const escrowId = generateEscrowId();
    const { escrowPda, pactPda } = deriveEscrowPdas(escrowId);
    const vaultAta = getAssociatedTokenAddress(freezableMintPubkey, escrowPda);

    await escrowProgram.methods.initializeEscrow({
      escrowId,
      beneficiary: beneficiary.publicKey,
      arbiter: arbiter.publicKey,
      escrowAmount: new anchor.BN(100_000),
      initiatorStake: new anchor.BN(0),
      beneficiaryStake: new anchor.BN(50_000),
      timeLockExpiresAt: new anchor.BN(Math.floor(Date.now() / 1000) + 3600),
      deliverablesHash: Array(32).fill(0),
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
    }).accounts({
      initiator: initiator.publicKey,
      escrowAccount: escrowPda,
      pactRecord: pactPda,
      mint: freezableMintPubkey,
      vault: vaultAta,
      initiatorReputation: initiatorRepPda,
      initiatorWallet: initiatorWalletPda,
      beneficiaryWallet: beneficiaryWalletPda,
      arbiterWallet: arbiterWalletPda,
      vaultpactProgram: vaultpactProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([initiator]).rpc();

    await escrowProgram.methods.depositFunds().accounts({
      initiator: initiator.publicKey,
      escrowAccount: escrowPda,
      initiatorTokenAccount: initiatorTokenAccount.publicKey,
      vault: vaultAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([initiator]).rpc();

    await freezeAccount(beneficiaryTokenAccount.publicKey, freezableMintPubkey);
    try {
      await escrowProgram.methods.stakeBeneficiary().accounts({
        beneficiary: beneficiary.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
        vault: vaultAta,
        beneficiaryReputation: beneficiaryRepPda,
        beneficiaryWallet: beneficiaryWalletPda,
        vaultpactProgram: vaultpactProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([beneficiary]).rpc();
      assert.fail("expected SPL AccountFrozen");
    } catch (err: any) {
      if (err.message?.includes("expected SPL AccountFrozen")) throw err;
      assert.include(getDiag(err), SPL_ACCOUNT_FROZEN_HEX);
    } finally {
      await thawAccount(beneficiaryTokenAccount.publicKey, freezableMintPubkey);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // Suite 3 — claim_released initiator_token_account constraint errors
  //
  // Anchor validates #[account(constraint = ...)] BEFORE the handler
  // runs, so these tests fail with UnauthorizedTokenAccount even though
  // the dispute window has not passed.
  // ═══════════════════════════════════════════════════════════════════

  it("T-SPL-7: claim_released rejects initiator_token_account with wrong owner (UnauthorizedTokenAccount)", async () => {
    const { escrowPda, vaultAta } = await buildReleasedEscrow();

    try {
      await escrowProgram.methods.claimReleased().accounts({
        beneficiary: beneficiary.publicKey,
        escrowAccount: escrowPda,
        vault: vaultAta,
        beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
        initiatorTokenAccount: strangerOwnedInitiatorMintAccount.publicKey,
        beneficiaryWallet: beneficiaryWalletPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        initiatorReputation: initiatorRepPda,
        beneficiaryReputation: beneficiaryRepPda,
        escrowAuthority,
        vaultpactProgram: vaultpactProgram.programId,
      }).signers([beneficiary]).rpc();
      assert.fail("expected UnauthorizedTokenAccount");
    } catch (err: any) {
      if (err.message?.includes("expected UnauthorizedTokenAccount")) throw err;
      assert.include(getDiag(err), "UnauthorizedTokenAccount");
    }
  });

  it("T-SPL-8: claim_released rejects initiator_token_account with wrong mint (UnauthorizedTokenAccount)", async () => {
    const { escrowPda, vaultAta } = await buildReleasedEscrow();

    try {
      await escrowProgram.methods.claimReleased().accounts({
        beneficiary: beneficiary.publicKey,
        escrowAccount: escrowPda,
        vault: vaultAta,
        beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
        initiatorTokenAccount: initiatorAltMintAccount.publicKey,
        beneficiaryWallet: beneficiaryWalletPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        initiatorReputation: initiatorRepPda,
        beneficiaryReputation: beneficiaryRepPda,
        escrowAuthority,
        vaultpactProgram: vaultpactProgram.programId,
      }).signers([beneficiary]).rpc();
      assert.fail("expected UnauthorizedTokenAccount");
    } catch (err: any) {
      if (err.message?.includes("expected UnauthorizedTokenAccount")) throw err;
      assert.include(getDiag(err), "UnauthorizedTokenAccount");
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // Suite 4 — refund token account constraint errors
  //
  // Both initiator_token_account and beneficiary_token_account carry
  // #[account(constraint = ...)] checks that fire before the handler's
  // TimeLockNotExpired guard, so no time-warp is needed.
  // ═══════════════════════════════════════════════════════════════════

  it("T-SPL-9: refund rejects initiator_token_account with wrong owner (UnauthorizedTokenAccount)", async () => {
    const { escrowPda, vaultAta } = await buildLockedEscrow();

    try {
      await escrowProgram.methods.refund().accounts({
        crank: provider.wallet.publicKey,
        escrowAccount: escrowPda,
        vault: vaultAta,
        initiatorTokenAccount: strangerOwnedInitiatorMintAccount.publicKey,
        beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        disputeRecord: null,
      }).rpc();
      assert.fail("expected UnauthorizedTokenAccount");
    } catch (err: any) {
      if (err.message?.includes("expected UnauthorizedTokenAccount")) throw err;
      assert.include(getDiag(err), "UnauthorizedTokenAccount");
    }
  });

  it("T-SPL-10: refund rejects initiator_token_account with wrong mint (UnauthorizedTokenAccount)", async () => {
    const { escrowPda, vaultAta } = await buildLockedEscrow();

    try {
      await escrowProgram.methods.refund().accounts({
        crank: provider.wallet.publicKey,
        escrowAccount: escrowPda,
        vault: vaultAta,
        initiatorTokenAccount: initiatorAltMintAccount.publicKey,
        beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        disputeRecord: null,
      }).rpc();
      assert.fail("expected UnauthorizedTokenAccount");
    } catch (err: any) {
      if (err.message?.includes("expected UnauthorizedTokenAccount")) throw err;
      assert.include(getDiag(err), "UnauthorizedTokenAccount");
    }
  });

  it("T-SPL-11: refund rejects beneficiary_token_account with wrong owner (UnauthorizedTokenAccount)", async () => {
    const { escrowPda, vaultAta } = await buildLockedEscrow();

    try {
      await escrowProgram.methods.refund().accounts({
        crank: provider.wallet.publicKey,
        escrowAccount: escrowPda,
        vault: vaultAta,
        initiatorTokenAccount: initiatorTokenAccount.publicKey,
        beneficiaryTokenAccount: strangerOwnedBeneficiaryMintAccount.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        disputeRecord: null,
      }).rpc();
      assert.fail("expected UnauthorizedTokenAccount");
    } catch (err: any) {
      if (err.message?.includes("expected UnauthorizedTokenAccount")) throw err;
      assert.include(getDiag(err), "UnauthorizedTokenAccount");
    }
  });

  it("T-SPL-12: refund rejects beneficiary_token_account with wrong mint (UnauthorizedTokenAccount)", async () => {
    const { escrowPda, vaultAta } = await buildLockedEscrow();

    try {
      await escrowProgram.methods.refund().accounts({
        crank: provider.wallet.publicKey,
        escrowAccount: escrowPda,
        vault: vaultAta,
        initiatorTokenAccount: initiatorTokenAccount.publicKey,
        beneficiaryTokenAccount: beneficiaryAltMintAccount.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        disputeRecord: null,
      }).rpc();
      assert.fail("expected UnauthorizedTokenAccount");
    } catch (err: any) {
      if (err.message?.includes("expected UnauthorizedTokenAccount")) throw err;
      assert.include(getDiag(err), "UnauthorizedTokenAccount");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Suite 5 — Frozen destination accounts during settlement (bankrun)
//
// These tests need clock time-warp to advance past the dispute window /
// timelock expiry. They are skipped when solana-bankrun is unavailable
// (Windows — no native binary).
// ═══════════════════════════════════════════════════════════════════════

(bankrunMod ? describe : describe.skip)(
  "bankrun: SPL frozen destination account errors — claim_released and refund (CAS-149)",
  function () {
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

    // Mint with freeze authority = authority keypair
    let brFreezableMint: anchor.web3.Keypair;
    let brInitiatorToken: anchor.web3.Keypair;
    let brBeneficiaryToken: anchor.web3.Keypair;

    let brInitiatorWalletPda: anchor.web3.PublicKey;
    let brBeneficiaryWalletPda: anchor.web3.PublicKey;
    let brArbiterWalletPda: anchor.web3.PublicKey;
    let brInitiatorRepPda: anchor.web3.PublicKey;
    let brBeneficiaryRepPda: anchor.web3.PublicKey;
    let brRegistryPda: anchor.web3.PublicKey;
    let brEscrowAuthority: anchor.web3.PublicKey;

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

    function makeTokenAccountData(
      mint: anchor.web3.PublicKey,
      owner: anchor.web3.PublicKey,
      amount: bigint,
      frozen = false,
    ): Buffer {
      const data = Buffer.alloc(165);
      mint.toBuffer().copy(data, 0);           // mint
      owner.toBuffer().copy(data, 32);          // owner
      data.writeBigUInt64LE(amount, 64);        // amount
      data.writeUInt32LE(0, 72);               // delegate COption::None
      data[108] = frozen ? 2 : 1;              // state: 1=Initialized, 2=Frozen
      data.writeUInt32LE(0, 109);              // is_native COption::None
      data.writeBigUInt64LE(0n, 117);          // delegated_amount
      data.writeUInt32LE(0, 125);              // close_authority COption::None
      return data;
    }

    function makeMintData(
      mintAuthority: anchor.web3.PublicKey,
      freezeAuthority: anchor.web3.PublicKey | null,
    ): Buffer {
      const data = Buffer.alloc(82);
      data.writeUInt32LE(1, 0);                         // mint_authority COption::Some
      mintAuthority.toBuffer().copy(data, 4);            // mint_authority pubkey
      data.writeBigUInt64LE(0n, 36);                    // supply
      data[44] = 6;                                     // decimals
      data[45] = 1;                                     // is_initialized
      if (freezeAuthority) {
        data.writeUInt32LE(1, 46);                      // freeze_authority COption::Some
        freezeAuthority.toBuffer().copy(data, 50);      // freeze_authority pubkey
      } else {
        data.writeUInt32LE(0, 46);                      // freeze_authority COption::None
      }
      return data;
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

    async function encodeRegistry(auth: anchor.web3.PublicKey, bump: number): Promise<Buffer> {
      return await brVaultpact.coder.accounts.encode("AttestationRegistry", {
        authority: auth,
        agentCount: new anchor.BN(2),
        bump,
      });
    }

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

    function brGetDiag(err: any): string {
      return (
        ((err.logs as string[] | undefined)?.join(" ") ?? "") +
        " " +
        (err.message ?? "")
      );
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

      // Agent wallet PDAs (pre-populated, bypasses secp256r1)
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

      // Reputation accounts (on-chain init for correct schema_version layout)
      const [iRepPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("reputation"), brInitiator.publicKey.toBuffer()], VAULTPACT_ID,
      );
      brInitiatorRepPda = iRepPda;
      await brVaultpact.methods.initReputation()
        .accounts({ reputationAccount: iRepPda, agent: brInitiator.publicKey, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([brInitiator]).rpc();

      const [bRepPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("reputation"), brBeneficiary.publicKey.toBuffer()], VAULTPACT_ID,
      );
      brBeneficiaryRepPda = bRepPda;
      await brVaultpact.methods.initReputation()
        .accounts({ reputationAccount: bRepPda, agent: brBeneficiary.publicKey, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([brBeneficiary]).rpc();

      // Escrow authority PDA
      [brEscrowAuthority] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("vp_escrow_authority")], ESCROW_ID,
      );

      // AttestationRegistry (pre-populated)
      const [regPda, regBump] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("attestation_registry")], VAULTPACT_ID,
      );
      brRegistryPda = regPda;
      setPrebuiltAccount(regPda, VAULTPACT_ID, await encodeRegistry(authority.publicKey, regBump));

      // Freezable mint: authority keypair is both mint authority and freeze authority
      brFreezableMint = anchor.web3.Keypair.generate();
      const mintRent = 1_000_000_000;
      setPrebuiltAccount(
        brFreezableMint.publicKey,
        TOKEN_PROGRAM_ID,
        makeMintData(authority.publicKey, authority.publicKey),
        mintRent,
      );

      // Token accounts (initialized, not frozen, 10M tokens each)
      brInitiatorToken = anchor.web3.Keypair.generate();
      brBeneficiaryToken = anchor.web3.Keypair.generate();
      setPrebuiltAccount(
        brInitiatorToken.publicKey,
        TOKEN_PROGRAM_ID,
        makeTokenAccountData(brFreezableMint.publicKey, brInitiator.publicKey, 10_000_000n),
        1_000_000_000,
      );
      setPrebuiltAccount(
        brBeneficiaryToken.publicKey,
        TOKEN_PROGRAM_ID,
        makeTokenAccountData(brFreezableMint.publicKey, brBeneficiary.publicKey, 10_000_000n),
        1_000_000_000,
      );
    });

    // Build escrow → Released state for claim_released tests
    async function brBuildReleasedEscrow(opts: {
      escrowAmount?: number;
      initiatorStake?: number;
      beneficiaryStake?: number;
      disputeDeadlineSecs?: number;
    } = {}): Promise<{
      escrowId: number[];
      escrowPda: anchor.web3.PublicKey;
      pactPda: anchor.web3.PublicKey;
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
      const vaultAta = getAssociatedTokenAddress(brFreezableMint.publicKey, escrowPda);

      const currentClock = await context.banksClient.getClock();
      const now = Number(currentClock.unixTimestamp);

      await brEscrow.methods.initializeEscrow({
        escrowId,
        beneficiary: brBeneficiary.publicKey,
        arbiter: brArbiter.publicKey,
        escrowAmount: new anchor.BN(opts.escrowAmount ?? 100_000),
        initiatorStake: new anchor.BN(opts.initiatorStake ?? 0),
        beneficiaryStake: new anchor.BN(opts.beneficiaryStake ?? 0),
        timeLockExpiresAt: new anchor.BN(now + 7 * 24 * 3600),
        deliverablesHash: Array(32).fill(0),
        deliverablesUri: Array(128).fill(0),
        autoReleaseOnExpiry: false,
        slashLoserStake: false,
        disputeDeadlineSecs: new anchor.BN(opts.disputeDeadlineSecs ?? 86400),
        initiatorReputationMin: new anchor.BN(0),
        beneficiaryReputationMin: new anchor.BN(0),
        initiatorMinTier: 0,
        initiatorMinPacts: new anchor.BN(0),
        beneficiaryMinTier: 0,
        beneficiaryMinPacts: new anchor.BN(0),
      }).accounts({
        initiator: brInitiator.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        mint: brFreezableMint.publicKey,
        vault: vaultAta,
        initiatorReputation: brInitiatorRepPda,
        initiatorWallet: brInitiatorWalletPda,
        beneficiaryWallet: brBeneficiaryWalletPda,
        arbiterWallet: brArbiterWalletPda,
        vaultpactProgram: brVaultpact.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      }).signers([brInitiator]).rpc();

      await brEscrow.methods.depositFunds().accounts({
        initiator: brInitiator.publicKey,
        escrowAccount: escrowPda,
        initiatorTokenAccount: brInitiatorToken.publicKey,
        vault: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([brInitiator]).rpc();

      await brEscrow.methods.stakeBeneficiary().accounts({
        beneficiary: brBeneficiary.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        beneficiaryTokenAccount: brBeneficiaryToken.publicKey,
        vault: vaultAta,
        beneficiaryReputation: brBeneficiaryRepPda,
        beneficiaryWallet: brBeneficiaryWalletPda,
        vaultpactProgram: brVaultpact.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([brBeneficiary]).rpc();

      await brEscrow.methods.lockEscrow().accounts({
        initiator: brInitiator.publicKey,
        beneficiary: brBeneficiary.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        vault: vaultAta,
        initiatorWallet: brInitiatorWalletPda,
        beneficiaryWallet: brBeneficiaryWalletPda,
        arbiterWallet: brArbiterWalletPda,
        initiatorReputation: brInitiatorRepPda,
        beneficiaryReputation: brBeneficiaryRepPda,
        vaultpactProgram: brVaultpact.programId,
      }).signers([brInitiator, brBeneficiary]).rpc();

      await brEscrow.methods.releaseEscrow().accounts({
        initiator: brInitiator.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        initiatorWallet: brInitiatorWalletPda,
      }).signers([brInitiator]).rpc();

      return { escrowId, escrowPda, pactPda, vaultAta };
    }

    // Build escrow → Locked state for refund tests; accepts short timelock
    async function brBuildLockedEscrow(opts: {
      timeLockSecs?: number;
      escrowAmount?: number;
      initiatorStake?: number;
      beneficiaryStake?: number;
    } = {}): Promise<{
      escrowId: number[];
      escrowPda: anchor.web3.PublicKey;
      pactPda: anchor.web3.PublicKey;
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
      const vaultAta = getAssociatedTokenAddress(brFreezableMint.publicKey, escrowPda);

      const currentClock = await context.banksClient.getClock();
      const now = Number(currentClock.unixTimestamp);
      const timeLockExpiresAt = now + (opts.timeLockSecs ?? 3600);

      await brEscrow.methods.initializeEscrow({
        escrowId,
        beneficiary: brBeneficiary.publicKey,
        arbiter: brArbiter.publicKey,
        escrowAmount: new anchor.BN(opts.escrowAmount ?? 100_000),
        initiatorStake: new anchor.BN(opts.initiatorStake ?? 0),
        beneficiaryStake: new anchor.BN(opts.beneficiaryStake ?? 0),
        timeLockExpiresAt: new anchor.BN(timeLockExpiresAt),
        deliverablesHash: Array(32).fill(0),
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
      }).accounts({
        initiator: brInitiator.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        mint: brFreezableMint.publicKey,
        vault: vaultAta,
        initiatorReputation: brInitiatorRepPda,
        initiatorWallet: brInitiatorWalletPda,
        beneficiaryWallet: brBeneficiaryWalletPda,
        arbiterWallet: brArbiterWalletPda,
        vaultpactProgram: brVaultpact.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      }).signers([brInitiator]).rpc();

      await brEscrow.methods.depositFunds().accounts({
        initiator: brInitiator.publicKey,
        escrowAccount: escrowPda,
        initiatorTokenAccount: brInitiatorToken.publicKey,
        vault: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([brInitiator]).rpc();

      await brEscrow.methods.stakeBeneficiary().accounts({
        beneficiary: brBeneficiary.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        beneficiaryTokenAccount: brBeneficiaryToken.publicKey,
        vault: vaultAta,
        beneficiaryReputation: brBeneficiaryRepPda,
        beneficiaryWallet: brBeneficiaryWalletPda,
        vaultpactProgram: brVaultpact.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([brBeneficiary]).rpc();

      await brEscrow.methods.lockEscrow().accounts({
        initiator: brInitiator.publicKey,
        beneficiary: brBeneficiary.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        vault: vaultAta,
        initiatorWallet: brInitiatorWalletPda,
        beneficiaryWallet: brBeneficiaryWalletPda,
        arbiterWallet: brArbiterWalletPda,
        initiatorReputation: brInitiatorRepPda,
        beneficiaryReputation: brBeneficiaryRepPda,
        vaultpactProgram: brVaultpact.programId,
      }).signers([brInitiator, brBeneficiary]).rpc();

      return { escrowId, escrowPda, pactPda, vaultAta };
    }

    // Helper: replace a token account in bankrun context with a frozen copy
    function freezeTokenAccountInBankrun(
      keypair: anchor.web3.Keypair,
      mint: anchor.web3.PublicKey,
      owner: anchor.web3.PublicKey,
      amount: bigint,
    ) {
      setPrebuiltAccount(
        keypair.publicKey,
        TOKEN_PROGRAM_ID,
        makeTokenAccountData(mint, owner, amount, true /* frozen */),
        1_000_000_000,
      );
    }

    function unfreezeTokenAccountInBankrun(
      keypair: anchor.web3.Keypair,
      mint: anchor.web3.PublicKey,
      owner: anchor.web3.PublicKey,
      amount: bigint,
    ) {
      setPrebuiltAccount(
        keypair.publicKey,
        TOKEN_PROGRAM_ID,
        makeTokenAccountData(mint, owner, amount, false),
        1_000_000_000,
      );
    }

    it("T-SPL-13: claim_released fails with SPL AccountFrozen (0x11) when beneficiary_token_account is frozen", async () => {
      const { escrowPda, vaultAta } = await brBuildReleasedEscrow();

      // Advance clock past the 1-day dispute window
      await warpClockForward(8 * 24 * 3600);

      // Freeze beneficiary destination account
      freezeTokenAccountInBankrun(
        brBeneficiaryToken,
        brFreezableMint.publicKey,
        brBeneficiary.publicKey,
        10_000_000n,
      );

      try {
        await brEscrow.methods.claimReleased().accounts({
          beneficiary: brBeneficiary.publicKey,
          escrowAccount: escrowPda,
          vault: vaultAta,
          beneficiaryTokenAccount: brBeneficiaryToken.publicKey,
          initiatorTokenAccount: brInitiatorToken.publicKey,
          beneficiaryWallet: brBeneficiaryWalletPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          initiatorReputation: brInitiatorRepPda,
          beneficiaryReputation: brBeneficiaryRepPda,
          escrowAuthority: brEscrowAuthority,
          vaultpactProgram: brVaultpact.programId,
        }).signers([brBeneficiary]).rpc();
        assert.fail("expected SPL AccountFrozen");
      } catch (err: any) {
        if (err.message?.includes("expected SPL AccountFrozen")) throw err;
        assert.include(brGetDiag(err), SPL_ACCOUNT_FROZEN_HEX);
      } finally {
        unfreezeTokenAccountInBankrun(
          brBeneficiaryToken,
          brFreezableMint.publicKey,
          brBeneficiary.publicKey,
          10_000_000n,
        );
      }
    });

    it("T-SPL-14: refund fails with SPL AccountFrozen (0x11) when initiator_token_account is frozen", async () => {
      // Short timelock (10s) so we can warp past it easily
      const { escrowPda, vaultAta } = await brBuildLockedEscrow({ timeLockSecs: 10 });

      await warpClockForward(60);

      freezeTokenAccountInBankrun(
        brInitiatorToken,
        brFreezableMint.publicKey,
        brInitiator.publicKey,
        10_000_000n,
      );

      try {
        await brEscrow.methods.refund().accounts({
          crank: brInitiator.publicKey,
          escrowAccount: escrowPda,
          vault: vaultAta,
          initiatorTokenAccount: brInitiatorToken.publicKey,
          beneficiaryTokenAccount: brBeneficiaryToken.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          disputeRecord: null,
        }).signers([brInitiator]).rpc();
        assert.fail("expected SPL AccountFrozen");
      } catch (err: any) {
        if (err.message?.includes("expected SPL AccountFrozen")) throw err;
        assert.include(brGetDiag(err), SPL_ACCOUNT_FROZEN_HEX);
      } finally {
        unfreezeTokenAccountInBankrun(
          brInitiatorToken,
          brFreezableMint.publicKey,
          brInitiator.publicKey,
          10_000_000n,
        );
      }
    });

    it("T-SPL-15: refund fails with SPL AccountFrozen (0x11) when beneficiary_token_account is frozen (beneficiary_stake > 0)", async () => {
      // beneficiary_stake > 0 ensures the beneficiary transfer branch executes
      const { escrowPda, vaultAta } = await brBuildLockedEscrow({
        timeLockSecs: 10,
        beneficiaryStake: 50_000,
      });

      await warpClockForward(60);

      freezeTokenAccountInBankrun(
        brBeneficiaryToken,
        brFreezableMint.publicKey,
        brBeneficiary.publicKey,
        10_000_000n,
      );

      try {
        await brEscrow.methods.refund().accounts({
          crank: brInitiator.publicKey,
          escrowAccount: escrowPda,
          vault: vaultAta,
          initiatorTokenAccount: brInitiatorToken.publicKey,
          beneficiaryTokenAccount: brBeneficiaryToken.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          disputeRecord: null,
        }).signers([brInitiator]).rpc();
        assert.fail("expected SPL AccountFrozen");
      } catch (err: any) {
        if (err.message?.includes("expected SPL AccountFrozen")) throw err;
        assert.include(brGetDiag(err), SPL_ACCOUNT_FROZEN_HEX);
      } finally {
        unfreezeTokenAccountInBankrun(
          brBeneficiaryToken,
          brFreezableMint.publicKey,
          brBeneficiary.publicKey,
          10_000_000n,
        );
      }
    });
  },
);

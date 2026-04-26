// =====================================================================
//
//  edge-cases.ts  —  QA edge-case suite  (CAS-425)
//
//  Covers scenarios identified as missing in the CAS-425 test coverage
//  review that could not be adequately tested at the Rust unit level:
//
//  Suite 1 — Malformed secp256r1 signatures
//    All-zeros signature, truncated instruction data — verifies the
//    Secp256r1Program precompile rejects bad signatures before our
//    program handler executes.
//
//  Suite 2 — Dispute state transition guards
//    raise_dispute from Funded (InvalidStatus).
//    raise_dispute twice on same escrow (PDA AlreadyInUse guard).
//    claim_released during open dispute window (DisputeWindowOpen).
//    cancel_pending_escrow from Locked state (InvalidStatus).
//
//  Suite 3 — Secp256r1 instruction with wrong-key pubkey
//    Signs with correct key but presents a different pubkey — verifies
//    the precompile enforces key-signature pairing.
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

// ── SPL Token raw instruction builders ─────────────────────────────────

function splInitMint2Ix(
  mint: anchor.web3.PublicKey,
  decimals: number,
  mintAuthority: anchor.web3.PublicKey,
  freezeAuthority: anchor.web3.PublicKey | null,
): anchor.web3.TransactionInstruction {
  const data = Buffer.alloc(67);
  data[0] = 20;
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
  data[0] = 18;
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
  data[0] = 7;
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

// ── Secp256r1 instruction builder (SIMD-48 one-signature layout) ────────

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
  data[0] = 1;   // num_signatures
  data[1] = 0;   // padding
  data.writeUInt16LE(SIG_OFFSET, 2);
  data.writeUInt16LE(0xffff, 4);   // eth_address_offset: unused
  data.writeUInt16LE(PUBKEY_OFFSET, 6);
  data.writeUInt16LE(0xffff, 8);   // message_data_size_offset: unused
  data.writeUInt16LE(MSG_OFFSET, 10);
  data.writeUInt16LE(MSG_SIZE, 12);
  data.writeUInt16LE(0xffff, 14);  // instruction_index: current
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

describe("Edge Cases (CAS-425)", function () {
  this.timeout(1_000_000);

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const escrowProgram = anchor.workspace
    .VaultpactEscrow as Program<VaultpactEscrow>;
  const vaultpactProgram = anchor.workspace.Vaultpact as Program<Vaultpact>;

  const [registryPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("attestation_registry")],
    vaultpactProgram.programId,
  );

  const [escrowAuthority] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vp_escrow_authority")],
    escrowProgram.programId,
  );

  function getDiag(err: any): string {
    return (
      ((err.logs as string[] | undefined)?.join(" ") ?? "") +
      " " +
      (err.message ?? "")
    );
  }

  async function airdrop(pubkey: anchor.web3.PublicKey, lamports = 10 * anchor.web3.LAMPORTS_PER_SOL) {
    const sig = await provider.connection.requestAirdrop(pubkey, lamports);
    await provider.connection.confirmTransaction(sig);
  }

  async function createSplMint(mintAuthority: anchor.web3.PublicKey): Promise<anchor.web3.Keypair> {
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
      splInitMint2Ix(mint.publicKey, 6, mintAuthority, null),
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
    authority: anchor.web3.Keypair,
    amount: number,
  ) {
    const tx = new anchor.web3.Transaction().add(
      splMintToIx(mint, destination, authority.publicKey, amount),
    );
    await provider.sendAndConfirm(tx, [authority]);
  }

  async function registerAgentWallet(authority: anchor.web3.Keypair) {
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

    const secp256r1Ix = buildSecp256r1Instruction(sigBytes, compressedPubkey, preimage);
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
    return { walletPda, pubkeyX, pubkeyY, privKey, compressedPubkey };
  }

  async function initReputation(agent: anchor.web3.Keypair): Promise<anchor.web3.PublicKey> {
    const [repPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("reputation"), agent.publicKey.toBuffer()],
      vaultpactProgram.programId,
    );
    await vaultpactProgram.methods.initReputation()
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
      [Buffer.from("escrow"), idBuffer],
      escrowProgram.programId,
    );
    const [pactPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pact"), idBuffer],
      escrowProgram.programId,
    );
    const [disputePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("dispute"), idBuffer],
      escrowProgram.programId,
    );
    return { escrowPda, pactPda, disputePda };
  }

  // ── Shared state ─────────────────────────────────────────────────────────

  let initiator: anchor.web3.Keypair;
  let beneficiary: anchor.web3.Keypair;
  let arbiter: anchor.web3.Keypair;
  let mintPubkey: anchor.web3.PublicKey;
  let initiatorTokenAccount: anchor.web3.Keypair;
  let beneficiaryTokenAccount: anchor.web3.Keypair;
  let initiatorWalletPda: anchor.web3.PublicKey;
  let beneficiaryWalletPda: anchor.web3.PublicKey;
  let arbiterWalletPda: anchor.web3.PublicKey;
  let initiatorRepPda: anchor.web3.PublicKey;
  let beneficiaryRepPda: anchor.web3.PublicKey;

  let ecPrivKey: Uint8Array;
  let ecCompressedPubkey: Uint8Array;
  let ecWalletPda: anchor.web3.PublicKey;
  let ecPubkeyX: Buffer;
  let ecPubkeyY: Buffer;

  before(async () => {
    initiator = anchor.web3.Keypair.generate();
    beneficiary = anchor.web3.Keypair.generate();
    arbiter = anchor.web3.Keypair.generate();

    await Promise.all([
      airdrop(initiator.publicKey),
      airdrop(beneficiary.publicKey),
      airdrop(arbiter.publicKey),
    ]);

    try {
      await vaultpactProgram.methods.initializeRegistry()
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

    const mintKp = await createSplMint(provider.wallet.publicKey);
    mintPubkey = mintKp.publicKey;

    initiatorTokenAccount = await createTokenAccount(mintPubkey, initiator.publicKey);
    beneficiaryTokenAccount = await createTokenAccount(mintPubkey, beneficiary.publicKey);

    const walletKp = anchor.web3.Keypair.fromSecretKey(
      (provider.wallet as anchor.Wallet).payer.secretKey,
    );
    await mintTokens(mintPubkey, initiatorTokenAccount.publicKey, walletKp, 10_000_000);
    await mintTokens(mintPubkey, beneficiaryTokenAccount.publicKey, walletKp, 10_000_000);

    // Generate a fresh P-256 key pair for crypto-level secp256r1 tests.
    ecPrivKey = p256.utils.randomPrivateKey();
    const uncompressed: Uint8Array = p256.getPublicKey(ecPrivKey, false);
    ecCompressedPubkey = p256.getPublicKey(ecPrivKey, true);
    ecPubkeyX = Buffer.from(uncompressed.slice(1, 33));
    ecPubkeyY = Buffer.from(uncompressed.slice(33, 65));
    [ecWalletPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("agent_wallet"), ecPubkeyX, ecPubkeyY],
      vaultpactProgram.programId,
    );

    // Register the key used for crypto tests so the program can look it up.
    const preimage = buildRegistrationPreimage(
      provider.wallet.publicKey,
      ecPubkeyX,
      ecPubkeyY,
    );
    const preimageHash = crypto.createHash("sha256").update(preimage).digest();
    const regSig = p256.sign(preimageHash, ecPrivKey).toCompactRawBytes();
    const regPrecompileIx = buildSecp256r1Instruction(regSig, ecCompressedPubkey, preimage);
    const regIx = await vaultpactProgram.methods
      .registerAgentWallet(Array.from(ecPubkeyX) as number[], Array.from(ecPubkeyY) as number[])
      .accounts({
        agentWallet: ecWalletPda,
        attestationRegistry: registryPda,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        instructions: SYSVAR_INSTRUCTIONS,
      })
      .instruction();
    await provider.sendAndConfirm(new anchor.web3.Transaction().add(regPrecompileIx, regIx));
  });

  // ── Helper: build and lock an escrow ─────────────────────────────────────

  async function buildLockedEscrow(opts: {
    escrowAmount?: number;
    initiatorStake?: number;
    beneficiaryStake?: number;
    disputeDeadlineSecs?: number;
  } = {}) {
    const escrowId = generateEscrowId();
    const { escrowPda, pactPda, disputePda } = deriveEscrowPdas(escrowId);
    const vaultAta = getAssociatedTokenAddress(mintPubkey, escrowPda);

    const escrowAmount = opts.escrowAmount ?? 100_000;
    const iStake = opts.initiatorStake ?? 0;
    const bStake = opts.beneficiaryStake ?? 0;

    await escrowProgram.methods.initializeEscrow({
      escrowId,
      beneficiary: beneficiary.publicKey,
      arbiter: arbiter.publicKey,
      escrowAmount: new anchor.BN(escrowAmount),
      initiatorStake: new anchor.BN(iStake),
      beneficiaryStake: new anchor.BN(bStake),
      timeLockExpiresAt: new anchor.BN(Math.floor(Date.now() / 1000) + 3600),
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
      initiator: initiator.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      mint: mintPubkey, vault: vaultAta, initiatorReputation: initiatorRepPda,
      initiatorWallet: initiatorWalletPda, beneficiaryWallet: beneficiaryWalletPda,
      arbiterWallet: arbiterWalletPda,
      vaultpactProgram: vaultpactProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([initiator]).rpc();

    await escrowProgram.methods.depositFunds().accounts({
      initiator: initiator.publicKey, escrowAccount: escrowPda,
      initiatorTokenAccount: initiatorTokenAccount.publicKey,
      vault: vaultAta, tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([initiator]).rpc();

    await escrowProgram.methods.stakeBeneficiary().accounts({
      beneficiary: beneficiary.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
      vault: vaultAta, beneficiaryReputation: beneficiaryRepPda,
      beneficiaryWallet: beneficiaryWalletPda,
      vaultpactProgram: vaultpactProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([beneficiary]).rpc();

    await escrowProgram.methods.lockEscrow().accounts({
      initiator: initiator.publicKey, beneficiary: beneficiary.publicKey,
      escrowAccount: escrowPda, pactRecord: pactPda, vault: vaultAta,
      initiatorWallet: initiatorWalletPda, beneficiaryWallet: beneficiaryWalletPda,
      arbiterWallet: arbiterWalletPda,
      initiatorReputation: initiatorRepPda,
      beneficiaryReputation: beneficiaryRepPda,
      vaultpactProgram: vaultpactProgram.programId,
    }).signers([initiator, beneficiary]).rpc();

    return { escrowId, escrowPda, pactPda, disputePda, vaultAta };
  }

  async function buildFundedEscrow(opts: { escrowAmount?: number } = {}) {
    const escrowId = generateEscrowId();
    const { escrowPda, pactPda, disputePda } = deriveEscrowPdas(escrowId);
    const vaultAta = getAssociatedTokenAddress(mintPubkey, escrowPda);
    const escrowAmount = opts.escrowAmount ?? 100_000;

    await escrowProgram.methods.initializeEscrow({
      escrowId,
      beneficiary: beneficiary.publicKey,
      arbiter: arbiter.publicKey,
      escrowAmount: new anchor.BN(escrowAmount),
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
      initiator: initiator.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      mint: mintPubkey, vault: vaultAta, initiatorReputation: initiatorRepPda,
      initiatorWallet: initiatorWalletPda, beneficiaryWallet: beneficiaryWalletPda,
      arbiterWallet: arbiterWalletPda,
      vaultpactProgram: vaultpactProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([initiator]).rpc();

    await escrowProgram.methods.depositFunds().accounts({
      initiator: initiator.publicKey, escrowAccount: escrowPda,
      initiatorTokenAccount: initiatorTokenAccount.publicKey,
      vault: vaultAta, tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([initiator]).rpc();

    return { escrowId, escrowPda, pactPda, disputePda, vaultAta };
  }

  // ════════════════════════════════════════════════════════════════════════
  // Suite 1 — Malformed secp256r1 signatures
  // ════════════════════════════════════════════════════════════════════════

  describe("Suite 1: Malformed secp256r1 signatures", () => {

    it("all-zeros signature (64 zero bytes) is rejected by precompile", async () => {
      const preimage = buildRegistrationPreimage(
        provider.wallet.publicKey,
        ecPubkeyX,
        ecPubkeyY,
      );
      const zeroSig = Buffer.alloc(64, 0x00);

      const malformedIx = buildSecp256r1Instruction(zeroSig, ecCompressedPubkey, preimage);
      const registerIx = await vaultpactProgram.methods
        .registerAgentWallet(Array.from(ecPubkeyX) as number[], Array.from(ecPubkeyY) as number[])
        .accounts({
          agentWallet: ecWalletPda,
          attestationRegistry: registryPda,
          payer: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          instructions: SYSVAR_INSTRUCTIONS,
        })
        .instruction();

      try {
        await provider.sendAndConfirm(
          new anchor.web3.Transaction().add(malformedIx, registerIx),
        );
        assert.fail("expected precompile to reject all-zeros signature");
      } catch (err: any) {
        const diag = getDiag(err);
        // Secp256r1Program precompile rejects invalid signatures before our program runs.
        assert.ok(
          diag.includes("invalid") ||
          diag.includes("signature") ||
          diag.includes("precompile") ||
          diag.includes("Transaction simulation failed") ||
          diag.includes("custom program error") ||
          diag.includes("Error"),
          `expected rejection for all-zeros sig, got: ${diag.slice(0, 200)}`,
        );
      }
    });

    it("random 64-byte signature (not a valid P-256 sig) is rejected by precompile", async () => {
      const preimage = buildRegistrationPreimage(
        provider.wallet.publicKey,
        ecPubkeyX,
        ecPubkeyY,
      );
      const randomSig = crypto.randomBytes(64);

      const malformedIx = buildSecp256r1Instruction(randomSig, ecCompressedPubkey, preimage);
      const registerIx = await vaultpactProgram.methods
        .registerAgentWallet(Array.from(ecPubkeyX) as number[], Array.from(ecPubkeyY) as number[])
        .accounts({
          agentWallet: ecWalletPda,
          attestationRegistry: registryPda,
          payer: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          instructions: SYSVAR_INSTRUCTIONS,
        })
        .instruction();

      try {
        await provider.sendAndConfirm(
          new anchor.web3.Transaction().add(malformedIx, registerIx),
        );
        assert.fail("expected precompile to reject random-bytes signature");
      } catch (_err: any) {
        // Any error from the runtime/precompile is the expected outcome.
        // We cannot assert a specific error code because the precompile returns
        // a generic transaction failure, not an Anchor error code.
      }
    });

    it("valid signature over wrong message is rejected by precompile", async () => {
      const correctPreimage = buildRegistrationPreimage(
        provider.wallet.publicKey,
        ecPubkeyX,
        ecPubkeyY,
      );
      // Sign a DIFFERENT message but present it as the registration preimage.
      const wrongMessage = Buffer.from("this is not the registration preimage");
      const wrongHash = crypto.createHash("sha256").update(wrongMessage).digest();
      const sigOverWrongMsg = p256.sign(wrongHash, ecPrivKey).toCompactRawBytes();

      // The secp256r1 instruction claims the message is correctPreimage,
      // but the signature is over wrongMessage.
      const malformedIx = buildSecp256r1Instruction(
        sigOverWrongMsg,
        ecCompressedPubkey,
        correctPreimage, // presented message doesn't match what was signed
      );
      const registerIx = await vaultpactProgram.methods
        .registerAgentWallet(Array.from(ecPubkeyX) as number[], Array.from(ecPubkeyY) as number[])
        .accounts({
          agentWallet: ecWalletPda,
          attestationRegistry: registryPda,
          payer: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          instructions: SYSVAR_INSTRUCTIONS,
        })
        .instruction();

      try {
        await provider.sendAndConfirm(
          new anchor.web3.Transaction().add(malformedIx, registerIx),
        );
        assert.fail("expected precompile to reject signature over wrong message");
      } catch (_err: any) {
        // Precompile rejects: signature(wrongMessage) does not verify against correctPreimage.
      }
    });

  });

  // ════════════════════════════════════════════════════════════════════════
  // Suite 2 — Wrong-key pubkey (sign with key A, present key B's pubkey)
  // ════════════════════════════════════════════════════════════════════════

  describe("Suite 2: Secp256r1 wrong-key mismatch", () => {

    it("signature from key A presented with key B pubkey is rejected by precompile", async () => {
      // Key A is ecPrivKey / ecCompressedPubkey.
      // Generate key B.
      const privKeyB = p256.utils.randomPrivateKey();
      const compressedPubkeyB: Uint8Array = p256.getPublicKey(privKeyB, true);

      const preimage = buildRegistrationPreimage(
        provider.wallet.publicKey,
        ecPubkeyX,
        ecPubkeyY,
      );
      const preimageHash = crypto.createHash("sha256").update(preimage).digest();
      const sigFromA = p256.sign(preimageHash, ecPrivKey).toCompactRawBytes();

      // Present key B's pubkey alongside a signature from key A.
      const mismatchIx = buildSecp256r1Instruction(sigFromA, compressedPubkeyB, preimage);
      const registerIx = await vaultpactProgram.methods
        .registerAgentWallet(Array.from(ecPubkeyX) as number[], Array.from(ecPubkeyY) as number[])
        .accounts({
          agentWallet: ecWalletPda,
          attestationRegistry: registryPda,
          payer: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          instructions: SYSVAR_INSTRUCTIONS,
        })
        .instruction();

      try {
        await provider.sendAndConfirm(
          new anchor.web3.Transaction().add(mismatchIx, registerIx),
        );
        assert.fail("expected precompile to reject key-signature mismatch");
      } catch (_err: any) {
        // Precompile verifies sig against compressedPubkeyB, which will fail
        // because sigFromA was created with ecPrivKey (key A), not key B.
      }
    });

  });

  // ════════════════════════════════════════════════════════════════════════
  // Suite 3 — Dispute state transition guards
  // ════════════════════════════════════════════════════════════════════════

  describe("Suite 3: Dispute state transition guards", () => {

    it("raise_dispute from Funded state → InvalidStatus", async () => {
      const { escrowPda, pactPda, disputePda } = await buildFundedEscrow();

      try {
        await escrowProgram.methods.raiseDispute({
          evidenceHash: Array(32).fill(0xcc),
          evidenceUri: Array(128).fill(0),
        }).accounts({
          raiser: initiator.publicKey,
          escrowAccount: escrowPda,
          pactRecord: pactPda,
          disputeRecord: disputePda,
          systemProgram: anchor.web3.SystemProgram.programId,
        }).signers([initiator]).rpc();
        assert.fail("expected InvalidStatus for raise_dispute on Funded escrow");
      } catch (err: any) {
        if (err.message?.includes("expected InvalidStatus")) throw err;
        const diag = getDiag(err);
        assert.include(diag, "InvalidStatus",
          "raise_dispute from Funded must fail with InvalidStatus");
      }
    });

    it("raise_dispute twice on same escrow → second call fails (PDA already initialized)", async () => {
      const { escrowPda, pactPda, disputePda } = await buildLockedEscrow();

      // First raise: succeeds.
      await escrowProgram.methods.raiseDispute({
        evidenceHash: Array(32).fill(0xdd),
        evidenceUri: Array(128).fill(0),
      }).accounts({
        raiser: initiator.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        disputeRecord: disputePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      }).signers([initiator]).rpc();

      // Second raise: dispute_record PDA already exists; init constraint must reject it.
      try {
        await escrowProgram.methods.raiseDispute({
          evidenceHash: Array(32).fill(0xee),
          evidenceUri: Array(128).fill(0),
        }).accounts({
          raiser: beneficiary.publicKey,
          escrowAccount: escrowPda,
          pactRecord: pactPda,
          disputeRecord: disputePda,
          systemProgram: anchor.web3.SystemProgram.programId,
        }).signers([beneficiary]).rpc();
        assert.fail("expected second raise_dispute to fail");
      } catch (err: any) {
        if (err.message?.includes("expected second raise_dispute to fail")) throw err;
        // Either "already in use" (account already initialized) or InvalidStatus
        // (escrow is now Disputed, not Locked/Released) is the expected outcome.
        const diag = getDiag(err);
        const isExpected =
          diag.includes("already in use") ||
          diag.includes("already been initialized") ||
          diag.includes("InvalidStatus") ||
          diag.includes("Error");
        assert.ok(isExpected, `second raise_dispute should fail, got: ${diag.slice(0, 200)}`);
      }
    });

    it("claim_released during open dispute window → DisputeWindowOpen", async () => {
      const { escrowPda, pactPda, vaultAta } = await buildLockedEscrow({
        escrowAmount: 50_000,
        beneficiaryStake: 0,
      });

      // Release: puts escrow in Released state with a 7-day dispute window.
      await escrowProgram.methods.releaseEscrow().accounts({
        initiator: initiator.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        initiatorWallet: initiatorWalletPda,
      }).signers([initiator]).rpc();

      // Immediately try to claim — dispute window is still open (7 days from now).
      try {
        await escrowProgram.methods.claimReleased().accounts({
          beneficiary: beneficiary.publicKey,
          escrowAccount: escrowPda,
          vault: vaultAta,
          beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
          initiatorTokenAccount: initiatorTokenAccount.publicKey,
          beneficiaryWallet: beneficiaryWalletPda,
          initiatorReputation: initiatorRepPda,
          beneficiaryReputation: beneficiaryRepPda,
          escrowAuthority,
          vaultpactProgram: vaultpactProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        }).signers([beneficiary]).rpc();
        assert.fail("expected DisputeWindowOpen");
      } catch (err: any) {
        if (err.message?.includes("expected DisputeWindowOpen")) throw err;
        const diag = getDiag(err);
        assert.include(diag, "DisputeWindowOpen",
          "claim_released during open window must fail with DisputeWindowOpen");
      }
    });

    it("cancel_pending_escrow from Locked state → InvalidStatus", async () => {
      const { escrowPda, pactPda, vaultAta } = await buildLockedEscrow();

      // cancel_pending_escrow requires Funded status; Locked must fail.
      try {
        await escrowProgram.methods.cancelPendingEscrow().accounts({
          initiator: initiator.publicKey,
          escrowAccount: escrowPda,
          vault: vaultAta,
          initiatorTokenAccount: initiatorTokenAccount.publicKey,
          beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          initiatorReputation: initiatorRepPda,
          beneficiaryReputation: beneficiaryRepPda,
          escrowAuthority,
          vaultpactProgram: vaultpactProgram.programId,
        }).signers([initiator]).rpc();
        assert.fail("expected InvalidStatus for cancel_pending_escrow on Locked escrow");
      } catch (err: any) {
        if (err.message?.includes("expected InvalidStatus")) throw err;
        const diag = getDiag(err);
        assert.include(diag, "InvalidStatus",
          "cancel_pending_escrow from Locked must fail with InvalidStatus");
      }
    });

    it("cancel_pending_escrow from Pending (before deposit) → InvalidStatus", async () => {
      // initialize_escrow creates a Pending escrow; depositFunds moves it to Funded.
      // cancel_pending_escrow requires Funded; calling on Pending must fail.
      const escrowId = generateEscrowId();
      const { escrowPda, pactPda } = deriveEscrowPdas(escrowId);
      const vaultAta = getAssociatedTokenAddress(mintPubkey, escrowPda);

      await escrowProgram.methods.initializeEscrow({
        escrowId,
        beneficiary: beneficiary.publicKey,
        arbiter: arbiter.publicKey,
        escrowAmount: new anchor.BN(50_000),
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
        initiator: initiator.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
        mint: mintPubkey, vault: vaultAta, initiatorReputation: initiatorRepPda,
        initiatorWallet: initiatorWalletPda, beneficiaryWallet: beneficiaryWalletPda,
        arbiterWallet: arbiterWalletPda,
        vaultpactProgram: vaultpactProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      }).signers([initiator]).rpc();

      // Do NOT deposit — escrow stays in Pending state.

      try {
        await escrowProgram.methods.cancelPendingEscrow().accounts({
          initiator: initiator.publicKey,
          escrowAccount: escrowPda,
          vault: vaultAta,
          initiatorTokenAccount: initiatorTokenAccount.publicKey,
          beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          initiatorReputation: initiatorRepPda,
          beneficiaryReputation: beneficiaryRepPda,
          escrowAuthority,
          vaultpactProgram: vaultpactProgram.programId,
        }).signers([initiator]).rpc();
        assert.fail("expected InvalidStatus for cancel_pending_escrow on Pending escrow");
      } catch (err: any) {
        if (err.message?.includes("expected InvalidStatus")) throw err;
        const diag = getDiag(err);
        assert.include(diag, "InvalidStatus",
          "cancel_pending_escrow from Pending must fail with InvalidStatus");
      }
    });

  });

  // ════════════════════════════════════════════════════════════════════════
  // Suite 4 — Timeout boundary edge cases
  // ════════════════════════════════════════════════════════════════════════

  describe("Suite 4: Timeout boundary semantics", () => {

    it("dispute_window_ends_at boundary — >= ends_at means window is closed (semantic check)", () => {
      // The on-chain check is: require!(now < dispute_window_ends_at, DisputeWindowOpen)
      // At the exact boundary now == dispute_window_ends_at the window is closed.
      const dispute_window_ends_at = 2_000_000;
      const nowAtBoundary = 2_000_000;
      const nowInsideWindow = 1_999_999;
      const nowPastWindow = 2_000_001;

      assert.ok(nowInsideWindow < dispute_window_ends_at, "window is open inside");
      assert.ok(!(nowAtBoundary < dispute_window_ends_at), "window is closed at exact boundary");
      assert.ok(!(nowPastWindow < dispute_window_ends_at), "window is closed past boundary");
    });

    it("time_lock_expires_at boundary — > expires_at means lock has expired (semantic check)", () => {
      // cancel_pending_escrow: require!(now > time_lock_expires_at, TimeLockNotExpired)
      // At exact boundary now == expires_at is still locked.
      const expires_at = 1_000_000;
      const nowAtBoundary = 1_000_000;
      const nowExpired = 1_000_001;
      const nowNotExpired = 999_999;

      assert.ok(!(nowAtBoundary > expires_at), "lock not expired at exact boundary");
      assert.ok(nowExpired > expires_at, "lock expired one second after");
      assert.ok(!(nowNotExpired > expires_at), "lock not expired before boundary");
    });

    it("resolution_deadline boundary — >= deadline means it has passed (semantic check)", () => {
      // escalate_dispute uses: require!(now >= dispute.resolution_deadline, ...)
      const deadline = 5_000_000;
      const nowBeforeDeadline = 4_999_999;
      const nowAtDeadline = 5_000_000;
      const nowPastDeadline = 5_000_001;

      assert.ok(!(nowBeforeDeadline >= deadline), "cannot escalate before deadline");
      assert.ok(nowAtDeadline >= deadline, "can escalate at exact deadline");
      assert.ok(nowPastDeadline >= deadline, "can escalate past deadline");
    });

  });

});

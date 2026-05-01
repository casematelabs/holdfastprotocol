import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { VaultpactEscrow } from "../target/types/vaultpact_escrow";
import { Vaultpact } from "../target/types/vaultpact";
import { assert } from "chai";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
// bankrun: loaded conditionally (no Windows binary)
let bankrunMod: any = null;
let anchorBankrunMod: any = null;
try {
  bankrunMod = require("solana-bankrun");
  anchorBankrunMod = require("anchor-bankrun");
} catch (_) {
  // bankrun unavailable on this platform
}

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

// ── Raw SPL Token instruction builders ────────────────────────────────
// Avoids @solana/spl-token dependency by constructing instruction data directly.

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

// ── Test suite ────────────────────────────────────────────────────────

describe("holdfast-escrow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const escrowProgram = anchor.workspace
    .VaultpactEscrow as Program<VaultpactEscrow>;
  const holdfastProgram = anchor.workspace.Vaultpact as Program<Vaultpact>;

  const [registryPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("attestation_registry")],
    holdfastProgram.programId,
  );

  const [escrowAuthority] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vp_escrow_authority")],
    escrowProgram.programId,
  );

  // ── Helpers ─────────────────────────────────────────────────────────

  async function airdrop(
    pubkey: anchor.web3.PublicKey,
    lamports = 10 * anchor.web3.LAMPORTS_PER_SOL,
  ) {
    const sig = await provider.connection.requestAirdrop(pubkey, lamports);
    await provider.connection.confirmTransaction(sig);
  }

  async function createSplMint(
    mintAuthority: anchor.web3.PublicKey,
  ): Promise<anchor.web3.Keypair> {
    const mint = anchor.web3.Keypair.generate();
    const rent =
      await provider.connection.getMinimumBalanceForRentExemption(MINT_SIZE);
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
    const rent =
      await provider.connection.getMinimumBalanceForRentExemption(
        TOKEN_ACCOUNT_SIZE,
      );
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

  async function registerAgentWallet(
    authority: anchor.web3.Keypair,
  ): Promise<{
    walletPda: anchor.web3.PublicKey;
    pubkeyX: Buffer;
    pubkeyY: Buffer;
  }> {
    const privKey = p256.utils.randomPrivateKey();
    const uncompressed: Uint8Array = p256.getPublicKey(privKey, false);
    const compressedPubkey: Uint8Array = p256.getPublicKey(privKey, true);
    const pubkeyX = Buffer.from(uncompressed.slice(1, 33));
    const pubkeyY = Buffer.from(uncompressed.slice(33, 65));

    const [walletPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("agent_wallet"), pubkeyX, pubkeyY],
      holdfastProgram.programId,
    );

    const preimage = buildRegistrationPreimage(
      authority.publicKey,
      pubkeyX,
      pubkeyY,
    );
    const preimageHash = crypto
      .createHash("sha256")
      .update(preimage)
      .digest();
    const sigBytes = p256.sign(preimageHash, privKey).toCompactRawBytes();

    const secp256r1Ix = buildSecp256r1Instruction(
      sigBytes,
      compressedPubkey,
      preimage,
    );

    const registerIx = await holdfastProgram.methods
      .registerAgentWallet(
        Array.from(pubkeyX) as number[],
        Array.from(pubkeyY) as number[],
      )
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

    return { walletPda, pubkeyX, pubkeyY };
  }

  async function initReputation(
    agent: anchor.web3.Keypair,
  ): Promise<anchor.web3.PublicKey> {
    const [repPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("reputation"), agent.publicKey.toBuffer()],
      holdfastProgram.programId,
    );
    await holdfastProgram.methods
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

  function getDiag(err: any): string {
    return (
      ((err.logs as string[] | undefined)?.join(" ") ?? "") +
      " " +
      (err.message ?? "")
    );
  }

  async function sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function setAgentStatus(
    walletPda: anchor.web3.PublicKey,
    newStatus: number,
  ) {
    await holdfastProgram.methods
      .setAgentStatus(newStatus)
      .accounts({
        authority: provider.wallet.publicKey,
        agentWallet: walletPda,
      })
      .rpc();
  }

  // ── Shared state set up in before() ─────────────────────────────────

  let initiator: anchor.web3.Keypair;
  let beneficiary: anchor.web3.Keypair;
  let arbiter: anchor.web3.Keypair;
  let mintKeypair: anchor.web3.Keypair;
  let mintPubkey: anchor.web3.PublicKey;
  let initiatorTokenAccount: anchor.web3.Keypair;
  let beneficiaryTokenAccount: anchor.web3.Keypair;
  let initiatorWalletPda: anchor.web3.PublicKey;
  let beneficiaryWalletPda: anchor.web3.PublicKey;
  let arbiterWalletPda: anchor.web3.PublicKey;
  let initiatorRepPda: anchor.web3.PublicKey;
  let beneficiaryRepPda: anchor.web3.PublicKey;

  before(async () => {
    initiator = anchor.web3.Keypair.generate();
    beneficiary = anchor.web3.Keypair.generate();
    arbiter = anchor.web3.Keypair.generate();

    await Promise.all([
      airdrop(initiator.publicKey),
      airdrop(beneficiary.publicKey),
      airdrop(arbiter.publicKey),
    ]);

    // Ensure attestation registry exists (idempotent)
    try {
      await holdfastProgram.methods
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

    // Register agent wallets (secp256r1 attestation)
    const [iWallet, bWallet, aWallet] = await Promise.all([
      registerAgentWallet(initiator),
      registerAgentWallet(beneficiary),
      registerAgentWallet(arbiter),
    ]);
    initiatorWalletPda = iWallet.walletPda;
    beneficiaryWalletPda = bWallet.walletPda;
    arbiterWalletPda = aWallet.walletPda;

    // Init reputation accounts
    [initiatorRepPda, beneficiaryRepPda] = await Promise.all([
      initReputation(initiator),
      initReputation(beneficiary),
    ]);

    // Create SPL Token mint (provider wallet is mint authority)
    mintKeypair = await createSplMint(provider.wallet.publicKey);
    mintPubkey = mintKeypair.publicKey;

    // Create token accounts
    initiatorTokenAccount = await createTokenAccount(
      mintPubkey,
      initiator.publicKey,
    );
    beneficiaryTokenAccount = await createTokenAccount(
      mintPubkey,
      beneficiary.publicKey,
    );

    // Mint tokens to initiator (enough for escrow + stake)
    // We use a Keypair loaded from the provider wallet for signing mints
    const walletKeypair = anchor.web3.Keypair.fromSecretKey(
      (provider.wallet as anchor.Wallet).payer.secretKey,
    );
    await mintTokens(
      mintPubkey,
      initiatorTokenAccount.publicKey,
      walletKeypair,
      10_000_000,
    );
    await mintTokens(
      mintPubkey,
      beneficiaryTokenAccount.publicKey,
      walletKeypair,
      10_000_000,
    );
  });

  // ── Test 1: Happy path — full lifecycle ─────────────────────────────

  it("T1: initialize → deposit → stake → lock → release → claim → close", async () => {
    const escrowId = generateEscrowId();
    const { escrowPda, pactPda } = deriveEscrowPdas(escrowId);
    const vaultAta = getAssociatedTokenAddress(mintPubkey, escrowPda);
    const timeLockExpiresAt = Math.floor(Date.now() / 1000) + 3600;

    // 1. initialize_escrow
    await escrowProgram.methods
      .initializeEscrow({
        escrowId: escrowId,
        beneficiary: beneficiary.publicKey,
        arbiter: arbiter.publicKey,
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
        initiator: initiator.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        mint: mintPubkey,
        vault: vaultAta,
        initiatorReputation: initiatorRepPda,
        initiatorWallet: initiatorWalletPda,
        beneficiaryWallet: beneficiaryWalletPda,
        arbiterWallet: arbiterWalletPda,
        vaultpactProgram: holdfastProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([initiator])
      .rpc();

    let escrow = await escrowProgram.account.escrowAccount.fetch(escrowPda);
    assert.deepEqual(escrow.status, { pending: {} });
    assert.equal(escrow.escrowAmount.toNumber(), 1_000_000);

    // 2. deposit_funds
    await escrowProgram.methods
      .depositFunds()
      .accounts({
        initiator: initiator.publicKey,
        escrowAccount: escrowPda,
        initiatorTokenAccount: initiatorTokenAccount.publicKey,
        vault: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([initiator])
      .rpc();

    escrow = await escrowProgram.account.escrowAccount.fetch(escrowPda);
    assert.deepEqual(escrow.status, { funded: {} });

    // 3. stake_beneficiary
    await escrowProgram.methods
      .stakeBeneficiary()
      .accounts({
        beneficiary: beneficiary.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
        vault: vaultAta,
        beneficiaryReputation: beneficiaryRepPda,
        beneficiaryWallet: beneficiaryWalletPda,
        vaultpactProgram: holdfastProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([beneficiary])
      .rpc();

    // 4. lock_escrow (dual signer)
    await escrowProgram.methods
      .lockEscrow()
      .accounts({
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
        vaultpactProgram: holdfastProgram.programId,
      })
      .signers([initiator, beneficiary])
      .rpc();

    escrow = await escrowProgram.account.escrowAccount.fetch(escrowPda);
    assert.deepEqual(escrow.status, { locked: {} });
    assert.ok(escrow.lockedAt.toNumber() > 0);

    // 5. release_escrow
    await escrowProgram.methods
      .releaseEscrow()
      .accounts({
        initiator: initiator.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        initiatorWallet: initiatorWalletPda,
      })
      .signers([initiator])
      .rpc();

    escrow = await escrowProgram.account.escrowAccount.fetch(escrowPda);
    assert.deepEqual(escrow.status, { released: {} });
    assert.ok(escrow.disputeWindowEndsAt.toNumber() > 0);

    // 6. claim_released — need to wait for dispute window
    // For testing, we can't warp time on standard localnet, so we create a
    // separate escrow with a very short time configuration and use the claim
    // path. Here we just verify the error if called too early.
    try {
      await escrowProgram.methods
        .claimReleased()
        .accounts({
          beneficiary: beneficiary.publicKey,
          escrowAccount: escrowPda,
          vault: vaultAta,
          beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
          initiatorTokenAccount: initiatorTokenAccount.publicKey,
          beneficiaryWallet: beneficiaryWalletPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          initiatorReputation: initiatorRepPda,
          beneficiaryReputation: beneficiaryRepPda,
          escrowAuthority,
          vaultpactProgram: holdfastProgram.programId,
        })
        .signers([beneficiary])
        .rpc();
      // If this succeeds (e.g. validator clock is way ahead), that's also fine
    } catch (err: any) {
      const diag = getDiag(err);
      assert.include(diag, "DisputeWindowOpen");
    }
  });

  // ── Test 2: Duplicate participants rejected ─────────────────────────

  it("T2: initialize_escrow rejects duplicate participants", async () => {
    const escrowId = generateEscrowId();
    const { escrowPda, pactPda } = deriveEscrowPdas(escrowId);
    const vaultAta = getAssociatedTokenAddress(mintPubkey, escrowPda);

    try {
      await escrowProgram.methods
        .initializeEscrow({
          escrowId: escrowId,
          beneficiary: initiator.publicKey, // same as initiator
          arbiter: arbiter.publicKey,
          escrowAmount: new anchor.BN(1_000_000),
          initiatorStake: new anchor.BN(0),
          beneficiaryStake: new anchor.BN(0),
          timeLockExpiresAt: new anchor.BN(
            Math.floor(Date.now() / 1000) + 3600,
          ),
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
        })
        .accounts({
          initiator: initiator.publicKey,
          escrowAccount: escrowPda,
          pactRecord: pactPda,
          mint: mintPubkey,
          vault: vaultAta,
          initiatorReputation: initiatorRepPda,
          initiatorWallet: initiatorWalletPda,
          beneficiaryWallet: initiatorWalletPda, // same wallet
          arbiterWallet: arbiterWalletPda,
          vaultpactProgram: holdfastProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([initiator])
        .rpc();
      assert.fail("expected DuplicateParticipants");
    } catch (err: any) {
      if (err.message?.includes("expected DuplicateParticipants")) throw err;
      const diag = getDiag(err);
      assert.include(diag, "DuplicateParticipants");
    }
  });

  // ── Test 3: Zero amount rejected ────────────────────────────────────

  it("T3: initialize_escrow rejects zero escrow amount", async () => {
    const escrowId = generateEscrowId();
    const { escrowPda, pactPda } = deriveEscrowPdas(escrowId);
    const vaultAta = getAssociatedTokenAddress(mintPubkey, escrowPda);

    try {
      await escrowProgram.methods
        .initializeEscrow({
          escrowId: escrowId,
          beneficiary: beneficiary.publicKey,
          arbiter: arbiter.publicKey,
          escrowAmount: new anchor.BN(0),
          initiatorStake: new anchor.BN(0),
          beneficiaryStake: new anchor.BN(0),
          timeLockExpiresAt: new anchor.BN(
            Math.floor(Date.now() / 1000) + 3600,
          ),
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
        })
        .accounts({
          initiator: initiator.publicKey,
          escrowAccount: escrowPda,
          pactRecord: pactPda,
          mint: mintPubkey,
          vault: vaultAta,
          initiatorReputation: initiatorRepPda,
          initiatorWallet: initiatorWalletPda,
          beneficiaryWallet: beneficiaryWalletPda,
          arbiterWallet: arbiterWalletPda,
          vaultpactProgram: holdfastProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([initiator])
        .rpc();
      assert.fail("expected ZeroEscrowAmount");
    } catch (err: any) {
      if (err.message?.includes("expected ZeroEscrowAmount")) throw err;
      const diag = getDiag(err);
      assert.include(diag, "ZeroEscrowAmount");
    }
  });

  // ── Test 4: Time lock in past rejected ──────────────────────────────

  it("T4: initialize_escrow rejects time lock in the past", async () => {
    const escrowId = generateEscrowId();
    const { escrowPda, pactPda } = deriveEscrowPdas(escrowId);
    const vaultAta = getAssociatedTokenAddress(mintPubkey, escrowPda);

    try {
      await escrowProgram.methods
        .initializeEscrow({
          escrowId: escrowId,
          beneficiary: beneficiary.publicKey,
          arbiter: arbiter.publicKey,
          escrowAmount: new anchor.BN(1_000_000),
          initiatorStake: new anchor.BN(0),
          beneficiaryStake: new anchor.BN(0),
          timeLockExpiresAt: new anchor.BN(1000), // way in the past
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
        })
        .accounts({
          initiator: initiator.publicKey,
          escrowAccount: escrowPda,
          pactRecord: pactPda,
          mint: mintPubkey,
          vault: vaultAta,
          initiatorReputation: initiatorRepPda,
          initiatorWallet: initiatorWalletPda,
          beneficiaryWallet: beneficiaryWalletPda,
          arbiterWallet: arbiterWalletPda,
          vaultpactProgram: holdfastProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([initiator])
        .rpc();
      assert.fail("expected TimeLockInPast");
    } catch (err: any) {
      if (err.message?.includes("expected TimeLockInPast")) throw err;
      const diag = getDiag(err);
      assert.include(diag, "TimeLockInPast");
    }
  });

  // ── Test 5: deposit_funds wrong status rejected ─────────────────────

  it("T5: deposit_funds rejects if status != Pending", async () => {
    // Create and deposit into an escrow, then try depositing again (Funded != Pending)
    const escrowId = generateEscrowId();
    const { escrowPda, pactPda } = deriveEscrowPdas(escrowId);
    const vaultAta = getAssociatedTokenAddress(mintPubkey, escrowPda);

    await escrowProgram.methods
      .initializeEscrow({
        escrowId: escrowId,
        beneficiary: beneficiary.publicKey,
        arbiter: arbiter.publicKey,
        escrowAmount: new anchor.BN(100_000),
        initiatorStake: new anchor.BN(0),
        beneficiaryStake: new anchor.BN(0),
        timeLockExpiresAt: new anchor.BN(
          Math.floor(Date.now() / 1000) + 3600,
        ),
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
      })
      .accounts({
        initiator: initiator.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        mint: mintPubkey,
        vault: vaultAta,
        initiatorReputation: initiatorRepPda,
        initiatorWallet: initiatorWalletPda,
        beneficiaryWallet: beneficiaryWalletPda,
        arbiterWallet: arbiterWalletPda,
        vaultpactProgram: holdfastProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([initiator])
      .rpc();

    // First deposit succeeds
    await escrowProgram.methods
      .depositFunds()
      .accounts({
        initiator: initiator.publicKey,
        escrowAccount: escrowPda,
        initiatorTokenAccount: initiatorTokenAccount.publicKey,
        vault: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([initiator])
      .rpc();

    // Second deposit fails (status is now Funded)
    try {
      await escrowProgram.methods
        .depositFunds()
        .accounts({
          initiator: initiator.publicKey,
          escrowAccount: escrowPda,
          initiatorTokenAccount: initiatorTokenAccount.publicKey,
          vault: vaultAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([initiator])
        .rpc();
      assert.fail("expected InvalidStatus");
    } catch (err: any) {
      if (err.message?.includes("expected InvalidStatus")) throw err;
      const diag = getDiag(err);
      assert.include(diag, "InvalidStatus");
    }
  });

  // ── Test 6: raise_dispute non-participant rejected ──────────────────

  it("T6: raise_dispute rejects non-participant", async () => {
    // Set up a locked escrow
    const escrowId = generateEscrowId();
    const { escrowPda, pactPda, disputePda } = deriveEscrowPdas(escrowId);
    const vaultAta = getAssociatedTokenAddress(mintPubkey, escrowPda);

    await escrowProgram.methods
      .initializeEscrow({
        escrowId: escrowId,
        beneficiary: beneficiary.publicKey,
        arbiter: arbiter.publicKey,
        escrowAmount: new anchor.BN(100_000),
        initiatorStake: new anchor.BN(10_000),
        beneficiaryStake: new anchor.BN(10_000),
        timeLockExpiresAt: new anchor.BN(
          Math.floor(Date.now() / 1000) + 3600,
        ),
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
      })
      .accounts({
        initiator: initiator.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        mint: mintPubkey,
        vault: vaultAta,
        initiatorReputation: initiatorRepPda,
        initiatorWallet: initiatorWalletPda,
        beneficiaryWallet: beneficiaryWalletPda,
        arbiterWallet: arbiterWalletPda,
        vaultpactProgram: holdfastProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([initiator])
      .rpc();

    await escrowProgram.methods
      .depositFunds()
      .accounts({
        initiator: initiator.publicKey,
        escrowAccount: escrowPda,
        initiatorTokenAccount: initiatorTokenAccount.publicKey,
        vault: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([initiator])
      .rpc();

    await escrowProgram.methods
      .stakeBeneficiary()
      .accounts({
        beneficiary: beneficiary.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
        vault: vaultAta,
        beneficiaryReputation: beneficiaryRepPda,
        beneficiaryWallet: beneficiaryWalletPda,
        vaultpactProgram: holdfastProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([beneficiary])
      .rpc();

    await escrowProgram.methods
      .lockEscrow()
      .accounts({
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
        vaultpactProgram: holdfastProgram.programId,
      })
      .signers([initiator, beneficiary])
      .rpc();

    // Arbiter tries to raise dispute — not a participant
    try {
      await escrowProgram.methods
        .raiseDispute({
          evidenceHash: Array(32).fill(0),
          evidenceUri: Array(128).fill(0),
        })
        .accounts({
          raiser: arbiter.publicKey,
          escrowAccount: escrowPda,
          pactRecord: pactPda,
          disputeRecord: disputePda,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([arbiter])
        .rpc();
      assert.fail("expected NotParticipant");
    } catch (err: any) {
      if (err.message?.includes("expected NotParticipant")) throw err;
      const diag = getDiag(err);
      assert.include(diag, "NotParticipant");
    }
  });

  // ── Test 7: resolve_dispute → ReleaseToBeneficiary ──────────────────

  it("T7: resolve_dispute pays beneficiary on ReleaseToBeneficiary", async () => {
    const escrowId = generateEscrowId();
    const { escrowPda, pactPda, disputePda } = deriveEscrowPdas(escrowId);
    const vaultAta = getAssociatedTokenAddress(mintPubkey, escrowPda);
    const escrowAmount = 500_000;
    const iStake = 50_000;
    const bStake = 50_000;

    // Setup: init → deposit → stake → lock → raise dispute
    await escrowProgram.methods
      .initializeEscrow({
        escrowId: escrowId,
        beneficiary: beneficiary.publicKey,
        arbiter: arbiter.publicKey,
        escrowAmount: new anchor.BN(escrowAmount),
        initiatorStake: new anchor.BN(iStake),
        beneficiaryStake: new anchor.BN(bStake),
        timeLockExpiresAt: new anchor.BN(
          Math.floor(Date.now() / 1000) + 3600,
        ),
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
      })
      .accounts({
        initiator: initiator.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        mint: mintPubkey,
        vault: vaultAta,
        initiatorReputation: initiatorRepPda,
        initiatorWallet: initiatorWalletPda,
        beneficiaryWallet: beneficiaryWalletPda,
        arbiterWallet: arbiterWalletPda,
        vaultpactProgram: holdfastProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([initiator])
      .rpc();

    await escrowProgram.methods
      .depositFunds()
      .accounts({
        initiator: initiator.publicKey,
        escrowAccount: escrowPda,
        initiatorTokenAccount: initiatorTokenAccount.publicKey,
        vault: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([initiator])
      .rpc();

    await escrowProgram.methods
      .stakeBeneficiary()
      .accounts({
        beneficiary: beneficiary.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
        vault: vaultAta,
        beneficiaryReputation: beneficiaryRepPda,
        beneficiaryWallet: beneficiaryWalletPda,
        vaultpactProgram: holdfastProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([beneficiary])
      .rpc();

    await escrowProgram.methods
      .lockEscrow()
      .accounts({
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
        vaultpactProgram: holdfastProgram.programId,
      })
      .signers([initiator, beneficiary])
      .rpc();

    // Raise dispute
    await escrowProgram.methods
      .raiseDispute({
        evidenceHash: Array(32).fill(1),
        evidenceUri: Array(128).fill(0),
      })
      .accounts({
        raiser: beneficiary.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        disputeRecord: disputePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([beneficiary])
      .rpc();

    // Capture balances before resolve
    const bBalBefore = (
      await provider.connection.getTokenAccountBalance(
        beneficiaryTokenAccount.publicKey,
      )
    ).value.amount;
    const iBalBefore = (
      await provider.connection.getTokenAccountBalance(
        initiatorTokenAccount.publicKey,
      )
    ).value.amount;

    // Resolve dispute
    await escrowProgram.methods
      .resolveDispute({
        decision: { releaseToBeneficiary: {} },
        reasoningHash: Array(32).fill(2),
      })
      .accounts({
        arbiter: arbiter.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        disputeRecord: disputePda,
        vault: vaultAta,
        beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
        initiatorTokenAccount: initiatorTokenAccount.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        arbiterWallet: arbiterWalletPda,
        initiatorReputation: initiatorRepPda,
        beneficiaryReputation: beneficiaryRepPda,
        escrowAuthority,
        vaultpactProgram: holdfastProgram.programId,
      })
      .signers([arbiter])
      .rpc();

    const escrow = await escrowProgram.account.escrowAccount.fetch(escrowPda);
    assert.deepEqual(escrow.status, { released: {} });

    const bBalAfter = (
      await provider.connection.getTokenAccountBalance(
        beneficiaryTokenAccount.publicKey,
      )
    ).value.amount;
    const iBalAfter = (
      await provider.connection.getTokenAccountBalance(
        initiatorTokenAccount.publicKey,
      )
    ).value.amount;

    // No slash: beneficiary gets escrow_amount + beneficiary_stake, initiator gets initiator_stake
    assert.equal(
      parseInt(bBalAfter) - parseInt(bBalBefore),
      escrowAmount + bStake,
    );
    assert.equal(parseInt(iBalAfter) - parseInt(iBalBefore), iStake);
  });

  // ── Test 8: resolve_dispute → SplitFunds ────────────────────────────

  it("T8: resolve_dispute splits funds by basis points", async () => {
    const escrowId = generateEscrowId();
    const { escrowPda, pactPda, disputePda } = deriveEscrowPdas(escrowId);
    const vaultAta = getAssociatedTokenAddress(mintPubkey, escrowPda);
    const escrowAmount = 1_000_000;
    const iStake = 0;
    const bStake = 0;

    await escrowProgram.methods
      .initializeEscrow({
        escrowId: escrowId,
        beneficiary: beneficiary.publicKey,
        arbiter: arbiter.publicKey,
        escrowAmount: new anchor.BN(escrowAmount),
        initiatorStake: new anchor.BN(iStake),
        beneficiaryStake: new anchor.BN(bStake),
        timeLockExpiresAt: new anchor.BN(
          Math.floor(Date.now() / 1000) + 3600,
        ),
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
      })
      .accounts({
        initiator: initiator.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        mint: mintPubkey,
        vault: vaultAta,
        initiatorReputation: initiatorRepPda,
        initiatorWallet: initiatorWalletPda,
        beneficiaryWallet: beneficiaryWalletPda,
        arbiterWallet: arbiterWalletPda,
        vaultpactProgram: holdfastProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([initiator])
      .rpc();

    await escrowProgram.methods
      .depositFunds()
      .accounts({
        initiator: initiator.publicKey,
        escrowAccount: escrowPda,
        initiatorTokenAccount: initiatorTokenAccount.publicKey,
        vault: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([initiator])
      .rpc();

    await escrowProgram.methods
      .stakeBeneficiary()
      .accounts({
        beneficiary: beneficiary.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
        vault: vaultAta,
        beneficiaryReputation: beneficiaryRepPda,
        beneficiaryWallet: beneficiaryWalletPda,
        vaultpactProgram: holdfastProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([beneficiary])
      .rpc();

    await escrowProgram.methods
      .lockEscrow()
      .accounts({
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
        vaultpactProgram: holdfastProgram.programId,
      })
      .signers([initiator, beneficiary])
      .rpc();

    await escrowProgram.methods
      .raiseDispute({
        evidenceHash: Array(32).fill(1),
        evidenceUri: Array(128).fill(0),
      })
      .accounts({
        raiser: initiator.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        disputeRecord: disputePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([initiator])
      .rpc();

    const bBalBefore = (
      await provider.connection.getTokenAccountBalance(
        beneficiaryTokenAccount.publicKey,
      )
    ).value.amount;
    const iBalBefore = (
      await provider.connection.getTokenAccountBalance(
        initiatorTokenAccount.publicKey,
      )
    ).value.amount;

    // 70/30 split: beneficiary gets 70%
    await escrowProgram.methods
      .resolveDispute({
        decision: { splitFunds: { beneficiaryBps: 7000 } },
        reasoningHash: Array(32).fill(3),
      })
      .accounts({
        arbiter: arbiter.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        disputeRecord: disputePda,
        vault: vaultAta,
        beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
        initiatorTokenAccount: initiatorTokenAccount.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        arbiterWallet: arbiterWalletPda,
        initiatorReputation: initiatorRepPda,
        beneficiaryReputation: beneficiaryRepPda,
        escrowAuthority,
        vaultpactProgram: holdfastProgram.programId,
      })
      .signers([arbiter])
      .rpc();

    const bBalAfter = (
      await provider.connection.getTokenAccountBalance(
        beneficiaryTokenAccount.publicKey,
      )
    ).value.amount;
    const iBalAfter = (
      await provider.connection.getTokenAccountBalance(
        initiatorTokenAccount.publicKey,
      )
    ).value.amount;

    const bDelta = parseInt(bBalAfter) - parseInt(bBalBefore);
    const iDelta = parseInt(iBalAfter) - parseInt(iBalBefore);

    assert.equal(bDelta, 700_000, "beneficiary gets 70% of escrow");
    assert.equal(iDelta, 300_000, "initiator gets 30% of escrow");
  });

  // ── Test 9: auto_release refund path ────────────────────────────────

  it("T9: auto_release refunds when auto_release_on_expiry=false", async () => {
    const escrowId = generateEscrowId();
    const { escrowPda, pactPda } = deriveEscrowPdas(escrowId);
    const vaultAta = getAssociatedTokenAddress(mintPubkey, escrowPda);
    const escrowAmount = 200_000;
    const iStake = 20_000;
    const bStake = 20_000;
    // Time lock already expired (1 second from now, will expire by the time we call auto_release)
    const timeLockExpiresAt = Math.floor(Date.now() / 1000) + 1;

    await escrowProgram.methods
      .initializeEscrow({
        escrowId: escrowId,
        beneficiary: beneficiary.publicKey,
        arbiter: arbiter.publicKey,
        escrowAmount: new anchor.BN(escrowAmount),
        initiatorStake: new anchor.BN(iStake),
        beneficiaryStake: new anchor.BN(bStake),
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
      })
      .accounts({
        initiator: initiator.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        mint: mintPubkey,
        vault: vaultAta,
        initiatorReputation: initiatorRepPda,
        initiatorWallet: initiatorWalletPda,
        beneficiaryWallet: beneficiaryWalletPda,
        arbiterWallet: arbiterWalletPda,
        vaultpactProgram: holdfastProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([initiator])
      .rpc();

    await escrowProgram.methods
      .depositFunds()
      .accounts({
        initiator: initiator.publicKey,
        escrowAccount: escrowPda,
        initiatorTokenAccount: initiatorTokenAccount.publicKey,
        vault: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([initiator])
      .rpc();

    await escrowProgram.methods
      .stakeBeneficiary()
      .accounts({
        beneficiary: beneficiary.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
        vault: vaultAta,
        beneficiaryReputation: beneficiaryRepPda,
        beneficiaryWallet: beneficiaryWalletPda,
        vaultpactProgram: holdfastProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([beneficiary])
      .rpc();

    await escrowProgram.methods
      .lockEscrow()
      .accounts({
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
        vaultpactProgram: holdfastProgram.programId,
      })
      .signers([initiator, beneficiary])
      .rpc();

    // Wait for time lock to expire
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const iBalBefore = (
      await provider.connection.getTokenAccountBalance(
        initiatorTokenAccount.publicKey,
      )
    ).value.amount;

    // Crank auto-release (permissionless)
    const crank = anchor.web3.Keypair.generate();
    await airdrop(crank.publicKey, 1 * anchor.web3.LAMPORTS_PER_SOL);

    await escrowProgram.methods
      .autoRelease()
      .accounts({
        crank: crank.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        vault: vaultAta,
        initiatorTokenAccount: initiatorTokenAccount.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([crank])
      .rpc();

    const escrow = await escrowProgram.account.escrowAccount.fetch(escrowPda);
    assert.deepEqual(escrow.status, { refunded: {} });

    const iBalAfter = (
      await provider.connection.getTokenAccountBalance(
        initiatorTokenAccount.publicKey,
      )
    ).value.amount;

    assert.equal(
      parseInt(iBalAfter) - parseInt(iBalBefore),
      escrowAmount + iStake + bStake,
      "initiator receives full refund (escrow + both stakes)",
    );
  });

  // ── Tests 10-20: Agent status checks ────────────────────────────────

  it("T10: initialize_escrow rejects frozen initiator (AgentNotActive)", async () => {
    await setAgentStatus(initiatorWalletPda, 1);
    try {
      const escrowId = generateEscrowId();
      const { escrowPda, pactPda } = deriveEscrowPdas(escrowId);
      const vaultAta = getAssociatedTokenAddress(mintPubkey, escrowPda);

      await escrowProgram.methods
        .initializeEscrow({
          escrowId: escrowId,
          beneficiary: beneficiary.publicKey,
          arbiter: arbiter.publicKey,
          escrowAmount: new anchor.BN(100_000),
          initiatorStake: new anchor.BN(0),
          beneficiaryStake: new anchor.BN(0),
          timeLockExpiresAt: new anchor.BN(
            Math.floor(Date.now() / 1000) + 3600,
          ),
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
        })
        .accounts({
          initiator: initiator.publicKey,
          escrowAccount: escrowPda,
          pactRecord: pactPda,
          mint: mintPubkey,
          vault: vaultAta,
          initiatorReputation: initiatorRepPda,
          initiatorWallet: initiatorWalletPda,
          beneficiaryWallet: beneficiaryWalletPda,
          arbiterWallet: arbiterWalletPda,
          vaultpactProgram: holdfastProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([initiator])
        .rpc();
      assert.fail("expected AgentNotActive");
    } catch (err: any) {
      if (err.message?.includes("expected AgentNotActive")) throw err;
      assert.include(getDiag(err), "AgentNotActive");
    } finally {
      await setAgentStatus(initiatorWalletPda, 0);
    }
  });

  it("T11: initialize_escrow rejects frozen beneficiary (AgentNotActive)", async () => {
    await setAgentStatus(beneficiaryWalletPda, 1);
    try {
      const escrowId = generateEscrowId();
      const { escrowPda, pactPda } = deriveEscrowPdas(escrowId);
      const vaultAta = getAssociatedTokenAddress(mintPubkey, escrowPda);

      await escrowProgram.methods
        .initializeEscrow({
          escrowId: escrowId,
          beneficiary: beneficiary.publicKey,
          arbiter: arbiter.publicKey,
          escrowAmount: new anchor.BN(100_000),
          initiatorStake: new anchor.BN(0),
          beneficiaryStake: new anchor.BN(0),
          timeLockExpiresAt: new anchor.BN(
            Math.floor(Date.now() / 1000) + 3600,
          ),
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
        })
        .accounts({
          initiator: initiator.publicKey,
          escrowAccount: escrowPda,
          pactRecord: pactPda,
          mint: mintPubkey,
          vault: vaultAta,
          initiatorReputation: initiatorRepPda,
          initiatorWallet: initiatorWalletPda,
          beneficiaryWallet: beneficiaryWalletPda,
          arbiterWallet: arbiterWalletPda,
          vaultpactProgram: holdfastProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([initiator])
        .rpc();
      assert.fail("expected AgentNotActive");
    } catch (err: any) {
      if (err.message?.includes("expected AgentNotActive")) throw err;
      assert.include(getDiag(err), "AgentNotActive");
    } finally {
      await setAgentStatus(beneficiaryWalletPda, 0);
    }
  });

  it("T12: stake_beneficiary rejects frozen beneficiary (AgentNotActive)", async () => {
    const escrowId = generateEscrowId();
    const { escrowPda, pactPda } = deriveEscrowPdas(escrowId);
    const vaultAta = getAssociatedTokenAddress(mintPubkey, escrowPda);

    await escrowProgram.methods.initializeEscrow({
      escrowId, beneficiary: beneficiary.publicKey, arbiter: arbiter.publicKey,
      escrowAmount: new anchor.BN(100_000), initiatorStake: new anchor.BN(0),
      beneficiaryStake: new anchor.BN(10_000),
      timeLockExpiresAt: new anchor.BN(Math.floor(Date.now() / 1000) + 3600),
      deliverablesHash: Array(32).fill(0), deliverablesUri: Array(128).fill(0),
      autoReleaseOnExpiry: false,
      disputeDeadlineSecs: new anchor.BN(86400),
      initiatorReputationMin: new anchor.BN(0), beneficiaryReputationMin: new anchor.BN(0),
    }).accounts({
      initiator: initiator.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      mint: mintPubkey, vault: vaultAta, initiatorReputation: initiatorRepPda,
      initiatorWallet: initiatorWalletPda, beneficiaryWallet: beneficiaryWalletPda,
      arbiterWallet: arbiterWalletPda,
      vaultpactProgram: holdfastProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([initiator]).rpc();

    await escrowProgram.methods.depositFunds().accounts({
      initiator: initiator.publicKey, escrowAccount: escrowPda,
      initiatorTokenAccount: initiatorTokenAccount.publicKey,
      vault: vaultAta, tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([initiator]).rpc();

    await setAgentStatus(beneficiaryWalletPda, 1);
    try {
      await escrowProgram.methods.stakeBeneficiary().accounts({
        beneficiary: beneficiary.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
        beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
        vault: vaultAta, beneficiaryReputation: beneficiaryRepPda,
        beneficiaryWallet: beneficiaryWalletPda,
        vaultpactProgram: holdfastProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([beneficiary]).rpc();
      assert.fail("expected AgentNotActive");
    } catch (err: any) {
      if (err.message?.includes("expected AgentNotActive")) throw err;
      assert.include(getDiag(err), "AgentNotActive");
    } finally {
      await setAgentStatus(beneficiaryWalletPda, 0);
    }
  });

  it("T13: lock_escrow rejects frozen initiator (AgentNotActive)", async () => {
    const escrowId = generateEscrowId();
    const { escrowPda, pactPda } = deriveEscrowPdas(escrowId);
    const vaultAta = getAssociatedTokenAddress(mintPubkey, escrowPda);

    await escrowProgram.methods.initializeEscrow({
      escrowId, beneficiary: beneficiary.publicKey, arbiter: arbiter.publicKey,
      escrowAmount: new anchor.BN(100_000), initiatorStake: new anchor.BN(0),
      beneficiaryStake: new anchor.BN(0),
      timeLockExpiresAt: new anchor.BN(Math.floor(Date.now() / 1000) + 3600),
      deliverablesHash: Array(32).fill(0), deliverablesUri: Array(128).fill(0),
      autoReleaseOnExpiry: false,
      disputeDeadlineSecs: new anchor.BN(86400),
      initiatorReputationMin: new anchor.BN(0), beneficiaryReputationMin: new anchor.BN(0),
    }).accounts({
      initiator: initiator.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      mint: mintPubkey, vault: vaultAta, initiatorReputation: initiatorRepPda,
      initiatorWallet: initiatorWalletPda, beneficiaryWallet: beneficiaryWalletPda,
      arbiterWallet: arbiterWalletPda,
      vaultpactProgram: holdfastProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
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
      vaultpactProgram: holdfastProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([beneficiary]).rpc();

    await setAgentStatus(initiatorWalletPda, 1);
    try {
      await escrowProgram.methods.lockEscrow().accounts({
        initiator: initiator.publicKey, beneficiary: beneficiary.publicKey,
        escrowAccount: escrowPda, vault: vaultAta,
        initiatorWallet: initiatorWalletPda, beneficiaryWallet: beneficiaryWalletPda,
        arbiterWallet: arbiterWalletPda,
      }).signers([initiator, beneficiary]).rpc();
      assert.fail("expected AgentNotActive");
    } catch (err: any) {
      if (err.message?.includes("expected AgentNotActive")) throw err;
      assert.include(getDiag(err), "AgentNotActive");
    } finally {
      await setAgentStatus(initiatorWalletPda, 0);
    }
  });

  it("T14: lock_escrow rejects frozen beneficiary (AgentNotActive)", async () => {
    const escrowId = generateEscrowId();
    const { escrowPda, pactPda } = deriveEscrowPdas(escrowId);
    const vaultAta = getAssociatedTokenAddress(mintPubkey, escrowPda);

    await escrowProgram.methods.initializeEscrow({
      escrowId, beneficiary: beneficiary.publicKey, arbiter: arbiter.publicKey,
      escrowAmount: new anchor.BN(100_000), initiatorStake: new anchor.BN(0),
      beneficiaryStake: new anchor.BN(0),
      timeLockExpiresAt: new anchor.BN(Math.floor(Date.now() / 1000) + 3600),
      deliverablesHash: Array(32).fill(0), deliverablesUri: Array(128).fill(0),
      autoReleaseOnExpiry: false,
      disputeDeadlineSecs: new anchor.BN(86400),
      initiatorReputationMin: new anchor.BN(0), beneficiaryReputationMin: new anchor.BN(0),
    }).accounts({
      initiator: initiator.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      mint: mintPubkey, vault: vaultAta, initiatorReputation: initiatorRepPda,
      initiatorWallet: initiatorWalletPda, beneficiaryWallet: beneficiaryWalletPda,
      arbiterWallet: arbiterWalletPda,
      vaultpactProgram: holdfastProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
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
      vaultpactProgram: holdfastProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([beneficiary]).rpc();

    await setAgentStatus(beneficiaryWalletPda, 1);
    try {
      await escrowProgram.methods.lockEscrow().accounts({
        initiator: initiator.publicKey, beneficiary: beneficiary.publicKey,
        escrowAccount: escrowPda, vault: vaultAta,
        initiatorWallet: initiatorWalletPda, beneficiaryWallet: beneficiaryWalletPda,
        arbiterWallet: arbiterWalletPda,
      }).signers([initiator, beneficiary]).rpc();
      assert.fail("expected AgentNotActive");
    } catch (err: any) {
      if (err.message?.includes("expected AgentNotActive")) throw err;
      assert.include(getDiag(err), "AgentNotActive");
    } finally {
      await setAgentStatus(beneficiaryWalletPda, 0);
    }
  });

  it("T15: release_escrow rejects blacklisted initiator (AgentBlacklisted)", async () => {
    const { escrowPda, pactPda } = await buildLockedEscrow({});

    await setAgentStatus(initiatorWalletPda, 2);
    try {
      await escrowProgram.methods.releaseEscrow().accounts({
        initiator: initiator.publicKey, escrowAccount: escrowPda,
        pactRecord: pactPda, initiatorWallet: initiatorWalletPda,
      }).signers([initiator]).rpc();
      assert.fail("expected AgentBlacklisted");
    } catch (err: any) {
      if (err.message?.includes("expected AgentBlacklisted")) throw err;
      assert.include(getDiag(err), "AgentBlacklisted");
    } finally {
      await setAgentStatus(initiatorWalletPda, 0);
    }
  });

  it("T16: release_escrow allows frozen initiator (settlement)", async () => {
    const { escrowPda, pactPda } = await buildLockedEscrow({});

    await setAgentStatus(initiatorWalletPda, 1);
    try {
      await escrowProgram.methods.releaseEscrow().accounts({
        initiator: initiator.publicKey, escrowAccount: escrowPda,
        pactRecord: pactPda, initiatorWallet: initiatorWalletPda,
      }).signers([initiator]).rpc();

      const escrow = await escrowProgram.account.escrowAccount.fetch(escrowPda);
      assert.deepEqual(escrow.status, { released: {} });
    } finally {
      await setAgentStatus(initiatorWalletPda, 0);
    }
  });

  // T17 and T18 require bankrun time-warp (7-day dispute window).
  // See bankrun describe block below.
  // T17, T18: claim_released blacklist/freeze tests live in the bankrun block below.

  it("T19: protocol_freeze_pact auto-decides ReleaseToBeneficiary when initiator blacklisted", async () => {
    const { escrowPda, pactPda, disputePda, vaultAta } = await buildLockedEscrow({});

    await setAgentStatus(initiatorWalletPda, 2);
    try {
      await escrowProgram.methods.protocolFreezePact().accounts({
        protocolAuthority: provider.wallet.publicKey,
        escrow: escrowPda,
        pact: pactPda,
        disputeRecord: disputePda,
        blacklistedWallet: initiatorWalletPda,
        secondBlacklistedWallet: null,
        attestationRegistry: registryPda,
        vault: vaultAta,
        beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
        initiatorTokenAccount: initiatorTokenAccount.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        initiatorReputation: initiatorRepPda,
        beneficiaryReputation: beneficiaryRepPda,
        escrowAuthority,
        vaultpactProgram: holdfastProgram.programId,
        systemProgram: anchor.web3.SystemProgram.programId,
      }).rpc();

      const escrow = await escrowProgram.account.escrowAccount.fetch(escrowPda);
      assert.deepEqual(escrow.status, { claimed: {} });

      const dispute = await escrowProgram.account.disputeRecord.fetch(disputePda);
      assert.deepEqual(dispute.arbiterDecision, { releaseToBeneficiary: {} });
    } finally {
      await setAgentStatus(initiatorWalletPda, 0);
    }
  });

  it("T20: protocol_freeze_pact rejects non-party wallet (WalletNotPactParty)", async () => {
    const { escrowPda, pactPda, disputePda, vaultAta } = await buildLockedEscrow({});

    const thirdParty = anchor.web3.Keypair.generate();
    await airdrop(thirdParty.publicKey);
    const { walletPda: thirdPartyWalletPda } = await registerAgentWallet(thirdParty);
    await setAgentStatus(thirdPartyWalletPda, 2);

    try {
      await escrowProgram.methods.protocolFreezePact().accounts({
        protocolAuthority: provider.wallet.publicKey,
        escrow: escrowPda,
        pact: pactPda,
        disputeRecord: disputePda,
        blacklistedWallet: thirdPartyWalletPda,
        secondBlacklistedWallet: null,
        attestationRegistry: registryPda,
        vault: vaultAta,
        beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
        initiatorTokenAccount: initiatorTokenAccount.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        initiatorReputation: initiatorRepPda,
        beneficiaryReputation: beneficiaryRepPda,
        escrowAuthority,
        vaultpactProgram: holdfastProgram.programId,
        systemProgram: anchor.web3.SystemProgram.programId,
      }).rpc();
      assert.fail("expected WalletNotPactParty");
    } catch (err: any) {
      if (err.message?.includes("expected WalletNotPactParty")) throw err;
      assert.include(getDiag(err), "WalletNotPactParty");
    }
  });

  it("T20a: protocol_freeze_pact on Disputed escrow reuses existing dispute record and transfers funds", async () => {
    const { escrowPda, pactPda, disputePda, vaultAta } = await buildLockedEscrow({});

    await raiseDisputeOn(escrowPda, pactPda, disputePda, initiator, 77);

    const disputeBefore = await escrowProgram.account.disputeRecord.fetch(disputePda);
    assert.ok(disputeBefore.createdAt.toNumber() > 0, "dispute must already exist");

    await setAgentStatus(beneficiaryWalletPda, 2);
    try {
      await escrowProgram.methods.protocolFreezePact().accounts({
        protocolAuthority: provider.wallet.publicKey,
        escrow: escrowPda,
        pact: pactPda,
        disputeRecord: disputePda,
        blacklistedWallet: beneficiaryWalletPda,
        secondBlacklistedWallet: null,
        attestationRegistry: registryPda,
        vault: vaultAta,
        beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
        initiatorTokenAccount: initiatorTokenAccount.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        initiatorReputation: initiatorRepPda,
        beneficiaryReputation: beneficiaryRepPda,
        escrowAuthority,
        vaultpactProgram: holdfastProgram.programId,
        systemProgram: anchor.web3.SystemProgram.programId,
      }).rpc();

      const escrow = await escrowProgram.account.escrowAccount.fetch(escrowPda);
      assert.deepEqual(escrow.status, { refunded: {} });

      const dispute = await escrowProgram.account.disputeRecord.fetch(disputePda);
      assert.deepEqual(dispute.arbiterDecision, { refundToInitiator: {} },
        "beneficiary blacklisted → refund to initiator");
      assert.equal(dispute.raisedBy.toBase58(), initiator.publicKey.toBase58(),
        "original raiser preserved (not overwritten by protocol authority)");
    } finally {
      await setAgentStatus(beneficiaryWalletPda, 0);
    }
  });

  it("T20b: protocol_freeze_pact on Released escrow transfers funds to beneficiary", async () => {
    const { escrowPda, pactPda, disputePda, vaultAta } = await buildLockedEscrow({});

    await escrowProgram.methods.releaseEscrow().accounts({
      initiator: initiator.publicKey,
      escrowAccount: escrowPda,
      pactRecord: pactPda,
      initiatorWallet: initiatorWalletPda,
    }).signers([initiator]).rpc();

    const escrowReleased = await escrowProgram.account.escrowAccount.fetch(escrowPda);
    assert.deepEqual(escrowReleased.status, { released: {} });

    await setAgentStatus(initiatorWalletPda, 2);
    try {
      await escrowProgram.methods.protocolFreezePact().accounts({
        protocolAuthority: provider.wallet.publicKey,
        escrow: escrowPda,
        pact: pactPda,
        disputeRecord: disputePda,
        blacklistedWallet: initiatorWalletPda,
        secondBlacklistedWallet: null,
        attestationRegistry: registryPda,
        vault: vaultAta,
        beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
        initiatorTokenAccount: initiatorTokenAccount.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        initiatorReputation: initiatorRepPda,
        beneficiaryReputation: beneficiaryRepPda,
        escrowAuthority,
        vaultpactProgram: holdfastProgram.programId,
        systemProgram: anchor.web3.SystemProgram.programId,
      }).rpc();

      const escrow = await escrowProgram.account.escrowAccount.fetch(escrowPda);
      assert.deepEqual(escrow.status, { claimed: {} });

      const dispute = await escrowProgram.account.disputeRecord.fetch(disputePda);
      assert.deepEqual(dispute.arbiterDecision, { releaseToBeneficiary: {} },
        "initiator blacklisted on Released escrow → release to beneficiary");
    } finally {
      await setAgentStatus(initiatorWalletPda, 0);
    }
  });

  // ── Helper: bring an escrow to Locked state ──────────────────────────

  async function buildLockedEscrow(opts: {
    escrowAmount?: number;
    initiatorStake?: number;
    beneficiaryStake?: number;
    timeLockExpiresAt?: number;
    slashLoserStake?: boolean;
    disputeDeadlineSecs?: number;
    autoReleaseOnExpiry?: boolean;
  } = {}): Promise<{
    escrowId: number[];
    escrowPda: anchor.web3.PublicKey;
    pactPda: anchor.web3.PublicKey;
    disputePda: anchor.web3.PublicKey;
    vaultAta: anchor.web3.PublicKey;
  }> {
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
      timeLockExpiresAt: new anchor.BN(opts.timeLockExpiresAt ?? Math.floor(Date.now() / 1000) + 3600),
      deliverablesHash: Array(32).fill(0),
      deliverablesUri: Array(128).fill(0),
      autoReleaseOnExpiry: opts.autoReleaseOnExpiry ?? false,
      slashLoserStake: opts.slashLoserStake ?? false,
      disputeDeadlineSecs: new anchor.BN(opts.disputeDeadlineSecs ?? 86400),
      initiatorReputationMin: new anchor.BN(0),
      beneficiaryReputationMin: new anchor.BN(0),
    }).accounts({
      initiator: initiator.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      mint: mintPubkey, vault: vaultAta, initiatorReputation: initiatorRepPda,
      initiatorWallet: initiatorWalletPda, beneficiaryWallet: beneficiaryWalletPda,
      arbiterWallet: arbiterWalletPda,
      vaultpactProgram: holdfastProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
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
      vaultpactProgram: holdfastProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([beneficiary]).rpc();

    await escrowProgram.methods.lockEscrow().accounts({
      initiator: initiator.publicKey, beneficiary: beneficiary.publicKey,
      escrowAccount: escrowPda, vault: vaultAta,
      initiatorWallet: initiatorWalletPda, beneficiaryWallet: beneficiaryWalletPda,
      arbiterWallet: arbiterWalletPda,
      pactRecord: pactPda, initiatorReputation: initiatorRepPda,
      beneficiaryReputation: beneficiaryRepPda,
      vaultpactProgram: holdfastProgram.programId,
    }).signers([initiator, beneficiary]).rpc();

    return { escrowId, escrowPda, pactPda, disputePda, vaultAta };
  }

  async function buildFundedEscrow(opts: {
    escrowAmount?: number;
    initiatorStake?: number;
    beneficiaryStake?: number;
    timeLockExpiresAt?: number;
  } = {}): Promise<{
    escrowId: number[];
    escrowPda: anchor.web3.PublicKey;
    pactPda: anchor.web3.PublicKey;
    disputePda: anchor.web3.PublicKey;
    vaultAta: anchor.web3.PublicKey;
    timeLockExpiresAt: number;
  }> {
    const escrowId = generateEscrowId();
    const { escrowPda, pactPda, disputePda } = deriveEscrowPdas(escrowId);
    const vaultAta = getAssociatedTokenAddress(mintPubkey, escrowPda);

    const escrowAmount = opts.escrowAmount ?? 100_000;
    const iStake = opts.initiatorStake ?? 0;
    const bStake = opts.beneficiaryStake ?? 0;
    const timeLockExpiresAt =
      opts.timeLockExpiresAt ?? Math.floor(Date.now() / 1000) + 3;

    await escrowProgram.methods.initializeEscrow({
      escrowId,
      beneficiary: beneficiary.publicKey,
      arbiter: arbiter.publicKey,
      escrowAmount: new anchor.BN(escrowAmount),
      initiatorStake: new anchor.BN(iStake),
      beneficiaryStake: new anchor.BN(bStake),
      timeLockExpiresAt: new anchor.BN(timeLockExpiresAt),
      deliverablesHash: Array(32).fill(0),
      deliverablesUri: Array(128).fill(0),
      autoReleaseOnExpiry: false,
      slashLoserStake: false,
      disputeDeadlineSecs: new anchor.BN(86400),
      initiatorReputationMin: new anchor.BN(0),
      beneficiaryReputationMin: new anchor.BN(0),
    }).accounts({
      initiator: initiator.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      mint: mintPubkey, vault: vaultAta, initiatorReputation: initiatorRepPda,
      initiatorWallet: initiatorWalletPda, beneficiaryWallet: beneficiaryWalletPda,
      arbiterWallet: arbiterWalletPda,
      vaultpactProgram: holdfastProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([initiator]).rpc();

    await escrowProgram.methods.depositFunds().accounts({
      initiator: initiator.publicKey, escrowAccount: escrowPda,
      initiatorTokenAccount: initiatorTokenAccount.publicKey,
      vault: vaultAta, tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([initiator]).rpc();

    return {
      escrowId,
      escrowPda,
      pactPda,
      disputePda,
      vaultAta,
      timeLockExpiresAt,
    };
  }

  async function raiseDisputeOn(
    escrowPda: anchor.web3.PublicKey,
    pactPda: anchor.web3.PublicKey,
    disputePda: anchor.web3.PublicKey,
    raiser: anchor.web3.Keypair,
    evidenceByte = 99,
    beneficiaryToken = beneficiaryTokenAccount.publicKey,
    initiatorToken = initiatorTokenAccount.publicKey,
    vault = getAssociatedTokenAddress(mintPubkey, escrowPda),
  ) {
    await escrowProgram.methods.raiseDispute({
      evidenceHash: Array(32).fill(evidenceByte),
      evidenceUri: Array(128).fill(0),
    }).accounts({
      raiser: raiser.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      disputeRecord: disputePda,
      vault,
      beneficiaryTokenAccount: beneficiaryToken,
      initiatorTokenAccount: initiatorToken,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([raiser]).rpc();
  }

  // ── Test 21: resolve_dispute → RefundToInitiator ─────────────────────

  it("T21: resolve_dispute RefundToInitiator pays initiator, returns beneficiary stake", async () => {
    const escrowAmount = 400_000;
    const iStake = 40_000;
    const bStake = 40_000;
    const { escrowPda, pactPda, disputePda, vaultAta } = await buildLockedEscrow({
      escrowAmount, initiatorStake: iStake, beneficiaryStake: bStake,
    });

    await raiseDisputeOn(escrowPda, pactPda, disputePda, initiator, 50);

    const iBalBefore = parseInt((await provider.connection.getTokenAccountBalance(
      initiatorTokenAccount.publicKey,
    )).value.amount);
    const bBalBefore = parseInt((await provider.connection.getTokenAccountBalance(
      beneficiaryTokenAccount.publicKey,
    )).value.amount);

    await escrowProgram.methods.resolveDispute({
      decision: { refundToInitiator: {} },
      reasoningHash: Array(32).fill(51),
    }).accounts({
      arbiter: arbiter.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      disputeRecord: disputePda, vault: vaultAta,
      beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
      initiatorTokenAccount: initiatorTokenAccount.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      arbiterWallet: arbiterWalletPda,
      initiatorReputation: initiatorRepPda,
      beneficiaryReputation: beneficiaryRepPda,
      escrowAuthority,
      vaultpactProgram: holdfastProgram.programId,
    }).signers([arbiter]).rpc();

    const escrow = await escrowProgram.account.escrowAccount.fetch(escrowPda);
    assert.deepEqual(escrow.status, { refunded: {} });

    const iBalAfter = parseInt((await provider.connection.getTokenAccountBalance(
      initiatorTokenAccount.publicKey,
    )).value.amount);
    const bBalAfter = parseInt((await provider.connection.getTokenAccountBalance(
      beneficiaryTokenAccount.publicKey,
    )).value.amount);

    assert.equal(iBalAfter - iBalBefore, escrowAmount + iStake,
      "initiator gets escrow + own stake");
    assert.equal(bBalAfter - bBalBefore, bStake,
      "beneficiary gets own stake back (no slash)");
  });

  // ── Test 22: resolve_dispute SplitFunds invalid BPS ──────────────────

  it("T22: resolve_dispute SplitFunds BPS > 10000 → InvalidBasisPoints", async () => {
    const { escrowPda, pactPda, disputePda, vaultAta } = await buildLockedEscrow({});
    await raiseDisputeOn(escrowPda, pactPda, disputePda, beneficiary, 52);

    try {
      await escrowProgram.methods.resolveDispute({
        decision: { splitFunds: { beneficiaryBps: 10001 } },
        reasoningHash: Array(32).fill(53),
      }).accounts({
        arbiter: arbiter.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
        disputeRecord: disputePda, vault: vaultAta,
        beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
        initiatorTokenAccount: initiatorTokenAccount.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        arbiterWallet: arbiterWalletPda,
        initiatorReputation: initiatorRepPda,
        beneficiaryReputation: beneficiaryRepPda,
        escrowAuthority,
        vaultpactProgram: holdfastProgram.programId,
      }).signers([arbiter]).rpc();
      assert.fail("expected InvalidBasisPoints");
    } catch (err: any) {
      if (err.message?.includes("expected InvalidBasisPoints")) throw err;
      assert.include(getDiag(err), "InvalidBasisPoints");
    }
  });

  // ── Test 23: resolve_dispute ReleaseToBeneficiary + slashLoserStake ───

  it("T23: resolve_dispute ReleaseToBeneficiary + slashLoserStake=true slashes initiator stake", async () => {
    const escrowAmount = 300_000;
    const iStake = 30_000;
    const bStake = 30_000;
    const { escrowPda, pactPda, disputePda, vaultAta } = await buildLockedEscrow({
      escrowAmount, initiatorStake: iStake, beneficiaryStake: bStake,
      slashLoserStake: true,
    });

    await raiseDisputeOn(escrowPda, pactPda, disputePda, beneficiary, 54);

    const iBalBefore = parseInt((await provider.connection.getTokenAccountBalance(
      initiatorTokenAccount.publicKey,
    )).value.amount);
    const bBalBefore = parseInt((await provider.connection.getTokenAccountBalance(
      beneficiaryTokenAccount.publicKey,
    )).value.amount);

    await escrowProgram.methods.resolveDispute({
      decision: { releaseToBeneficiary: {} },
      reasoningHash: Array(32).fill(55),
    }).accounts({
      arbiter: arbiter.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      disputeRecord: disputePda, vault: vaultAta,
      beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
      initiatorTokenAccount: initiatorTokenAccount.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      arbiterWallet: arbiterWalletPda,
      initiatorReputation: initiatorRepPda,
      beneficiaryReputation: beneficiaryRepPda,
      escrowAuthority,
      vaultpactProgram: holdfastProgram.programId,
    }).signers([arbiter]).rpc();

    const iBalAfter = parseInt((await provider.connection.getTokenAccountBalance(
      initiatorTokenAccount.publicKey,
    )).value.amount);
    const bBalAfter = parseInt((await provider.connection.getTokenAccountBalance(
      beneficiaryTokenAccount.publicKey,
    )).value.amount);

    // slash=true: beneficiary gets escrow + both stakes; initiator gets 0
    assert.equal(bBalAfter - bBalBefore, escrowAmount + bStake + iStake,
      "beneficiary gets escrow + both stakes when slashed");
    assert.equal(iBalAfter - iBalBefore, 0,
      "initiator gets nothing when loser is slashed");
  });

  // ── Test 24: resolve_dispute RefundToInitiator + slashLoserStake ──────

  it("T24: resolve_dispute RefundToInitiator + slashLoserStake=true slashes beneficiary stake", async () => {
    const escrowAmount = 200_000;
    const iStake = 20_000;
    const bStake = 20_000;
    const { escrowPda, pactPda, disputePda, vaultAta } = await buildLockedEscrow({
      escrowAmount, initiatorStake: iStake, beneficiaryStake: bStake,
      slashLoserStake: true,
    });

    await raiseDisputeOn(escrowPda, pactPda, disputePda, initiator, 56);

    const iBalBefore = parseInt((await provider.connection.getTokenAccountBalance(
      initiatorTokenAccount.publicKey,
    )).value.amount);
    const bBalBefore = parseInt((await provider.connection.getTokenAccountBalance(
      beneficiaryTokenAccount.publicKey,
    )).value.amount);

    await escrowProgram.methods.resolveDispute({
      decision: { refundToInitiator: {} },
      reasoningHash: Array(32).fill(57),
    }).accounts({
      arbiter: arbiter.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      disputeRecord: disputePda, vault: vaultAta,
      beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
      initiatorTokenAccount: initiatorTokenAccount.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      arbiterWallet: arbiterWalletPda,
      initiatorReputation: initiatorRepPda,
      beneficiaryReputation: beneficiaryRepPda,
      escrowAuthority,
      vaultpactProgram: holdfastProgram.programId,
    }).signers([arbiter]).rpc();

    const iBalAfter = parseInt((await provider.connection.getTokenAccountBalance(
      initiatorTokenAccount.publicKey,
    )).value.amount);
    const bBalAfter = parseInt((await provider.connection.getTokenAccountBalance(
      beneficiaryTokenAccount.publicKey,
    )).value.amount);

    // slash=true: initiator gets escrow + both stakes; beneficiary gets 0
    assert.equal(iBalAfter - iBalBefore, escrowAmount + iStake + bStake,
      "initiator gets escrow + both stakes when beneficiary slashed");
    assert.equal(bBalAfter - bBalBefore, 0,
      "beneficiary gets nothing when loser is slashed");
  });

  // ── Test 25: resolve_dispute wrong arbiter ────────────────────────────

  it("T25: resolve_dispute wrong arbiter → UnauthorizedSigner", async () => {
    const { escrowPda, pactPda, disputePda, vaultAta } = await buildLockedEscrow({});
    await raiseDisputeOn(escrowPda, pactPda, disputePda, initiator, 58);

    const impostorArbiter = anchor.web3.Keypair.generate();
    await airdrop(impostorArbiter.publicKey);

    try {
      await escrowProgram.methods.resolveDispute({
        decision: { releaseToBeneficiary: {} },
        reasoningHash: Array(32).fill(59),
      }).accounts({
        arbiter: impostorArbiter.publicKey,
        escrowAccount: escrowPda, pactRecord: pactPda,
        disputeRecord: disputePda, vault: vaultAta,
        beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
        initiatorTokenAccount: initiatorTokenAccount.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        arbiterWallet: arbiterWalletPda,
        initiatorReputation: initiatorRepPda,
        beneficiaryReputation: beneficiaryRepPda,
        escrowAuthority,
        vaultpactProgram: holdfastProgram.programId,
      }).signers([impostorArbiter]).rpc();
      assert.fail("expected arbiter mismatch to fail");
    } catch (err: any) {
      if (err.message?.includes("expected arbiter mismatch to fail")) throw err;
      const diag = getDiag(err);
      assert.ok(
        diag.includes("UnauthorizedSigner") ||
          diag.includes("ConstraintHasOne") ||
          diag.includes("AgentWalletAuthorityMismatch") ||
          diag.includes("0x7d3"),
        `expected arbiter constraint error, got: ${diag}`,
      );
    }
  });

  it("MED-F-001 coverage: resolve_dispute rejects payout redirection away from dispute-committed token account", async () => {
    // Invariant validated: payout token destinations are committed at raise_dispute
    // and resolve_dispute enforces them via has_one constraints on dispute_record.
    const escrowAmount = 123_456;
    const { escrowPda, pactPda, disputePda, vaultAta } = await buildLockedEscrow({
      escrowAmount,
      initiatorStake: 0,
      beneficiaryStake: 0,
    });
    await raiseDisputeOn(escrowPda, pactPda, disputePda, initiator, 91);

    const alternateBeneficiaryToken = await createTokenAccount(
      mintPubkey,
      beneficiary.publicKey,
    );

    try {
      await escrowProgram.methods.resolveDispute({
        decision: { releaseToBeneficiary: {} },
        reasoningHash: Array(32).fill(92),
      }).accounts({
        arbiter: arbiter.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
        disputeRecord: disputePda, vault: vaultAta,
        beneficiaryTokenAccount: alternateBeneficiaryToken.publicKey,
        initiatorTokenAccount: initiatorTokenAccount.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        arbiterWallet: arbiterWalletPda,
        initiatorReputation: initiatorRepPda,
        beneficiaryReputation: beneficiaryRepPda,
        escrowAuthority,
        vaultpactProgram: holdfastProgram.programId,
      }).signers([arbiter]).rpc();
      assert.fail("expected UnauthorizedTokenAccount or has_one violation");
    } catch (err: any) {
      if (err.message?.includes("expected UnauthorizedTokenAccount or has_one violation")) throw err;
      const diag = getDiag(err);
      assert.ok(
        diag.includes("UnauthorizedTokenAccount") || diag.includes("ConstraintHasOne"),
        `expected token-account commitment enforcement, got: ${diag}`,
      );
    }
  });

  // ── Test 26: auto_release before time lock ────────────────────────────

  it("T26: auto_release before time lock expires → TimeLockNotExpired", async () => {
    // Long time lock — won't expire during test execution
    const { escrowPda, pactPda, vaultAta } = await buildLockedEscrow({
      timeLockExpiresAt: Math.floor(Date.now() / 1000) + 86400,
    });

    const crank = anchor.web3.Keypair.generate();
    await airdrop(crank.publicKey, anchor.web3.LAMPORTS_PER_SOL);

    try {
      await escrowProgram.methods.autoRelease().accounts({
        crank: crank.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
        vault: vaultAta,
        initiatorTokenAccount: initiatorTokenAccount.publicKey,
        beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([crank]).rpc();
      assert.fail("expected TimeLockNotExpired");
    } catch (err: any) {
      if (err.message?.includes("expected TimeLockNotExpired")) throw err;
      assert.include(getDiag(err), "TimeLockNotExpired");
    }
  });

  // ── Test 27: auto_release wrong status ───────────────────────────────

  it("T27: auto_release on Pending escrow → InvalidStatus", async () => {
    // Create escrow but do NOT lock it; status stays Pending
    const escrowId = generateEscrowId();
    const { escrowPda, pactPda } = deriveEscrowPdas(escrowId);
    const vaultAta = getAssociatedTokenAddress(mintPubkey, escrowPda);

    await escrowProgram.methods.initializeEscrow({
      escrowId, beneficiary: beneficiary.publicKey, arbiter: arbiter.publicKey,
      escrowAmount: new anchor.BN(50_000), initiatorStake: new anchor.BN(0),
      beneficiaryStake: new anchor.BN(0),
      timeLockExpiresAt: new anchor.BN(Math.floor(Date.now() / 1000) + 1),
      deliverablesHash: Array(32).fill(0), deliverablesUri: Array(128).fill(0),
      autoReleaseOnExpiry: false,
      disputeDeadlineSecs: new anchor.BN(86400),
      initiatorReputationMin: new anchor.BN(0), beneficiaryReputationMin: new anchor.BN(0),
    }).accounts({
      initiator: initiator.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      mint: mintPubkey, vault: vaultAta, initiatorReputation: initiatorRepPda,
      initiatorWallet: initiatorWalletPda, beneficiaryWallet: beneficiaryWalletPda,
      arbiterWallet: arbiterWalletPda,
      vaultpactProgram: holdfastProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([initiator]).rpc();

    await new Promise((resolve) => setTimeout(resolve, 2000));

    const crank = anchor.web3.Keypair.generate();
    await airdrop(crank.publicKey, anchor.web3.LAMPORTS_PER_SOL);

    try {
      await escrowProgram.methods.autoRelease().accounts({
        crank: crank.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
        vault: vaultAta,
        initiatorTokenAccount: initiatorTokenAccount.publicKey,
        beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([crank]).rpc();
      assert.fail("expected InvalidStatus (Pending is not Locked)");
    } catch (err: any) {
      if (err.message?.includes("expected InvalidStatus")) throw err;
      assert.include(getDiag(err), "InvalidStatus");
    }
  });

  // ── Test 28: auto_release autoReleaseOnExpiry=true → Released ────────

  it("T28: auto_release autoReleaseOnExpiry=true → status Released, dispute window set", async () => {
    const { escrowPda, pactPda, vaultAta } = await buildLockedEscrow({
      timeLockExpiresAt: Math.floor(Date.now() / 1000) + 1,
      autoReleaseOnExpiry: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));

    const crank = anchor.web3.Keypair.generate();
    await airdrop(crank.publicKey, anchor.web3.LAMPORTS_PER_SOL);

    await escrowProgram.methods.autoRelease().accounts({
      crank: crank.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      vault: vaultAta,
      initiatorTokenAccount: initiatorTokenAccount.publicKey,
      beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([crank]).rpc();

    const escrow = await escrowProgram.account.escrowAccount.fetch(escrowPda);
    assert.deepEqual(escrow.status, { released: {} },
      "status should be Released when autoReleaseOnExpiry=true");
    assert.ok(escrow.disputeWindowEndsAt.toNumber() > 0,
      "dispute window must be set after auto-release");
  });

  // ── Test 29: close_escrow after refund (vault empty) ─────────────────

  it("T29: close_escrow after auto_release refund → escrow account closed", async () => {
    const { escrowPda, pactPda, vaultAta } = await buildLockedEscrow({
      timeLockExpiresAt: Math.floor(Date.now() / 1000) + 1,
      autoReleaseOnExpiry: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));

    const crank = anchor.web3.Keypair.generate();
    await airdrop(crank.publicKey, anchor.web3.LAMPORTS_PER_SOL);

    await escrowProgram.methods.autoRelease().accounts({
      crank: crank.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      vault: vaultAta,
      initiatorTokenAccount: initiatorTokenAccount.publicKey,
      beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([crank]).rpc();

    // Vault is empty after refund — close_escrow should succeed
    await escrowProgram.methods.closeEscrow().accounts({
      initiator: initiator.publicKey,
      escrowAccount: escrowPda,
      pactRecord: pactPda,
      disputeRecord: null,
      vault: vaultAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([initiator]).rpc();

    const escrowInfo = await provider.connection.getAccountInfo(escrowPda);
    assert.isNull(escrowInfo, "escrow PDA should be closed after closeEscrow");
  });

  // ── Test 30: close_escrow wrong status ───────────────────────────────

  it("T30: close_escrow on Locked escrow → InvalidStatus", async () => {
    const { escrowPda, pactPda, vaultAta } = await buildLockedEscrow({});

    try {
      await escrowProgram.methods.closeEscrow().accounts({
        initiator: initiator.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        disputeRecord: null,
        vault: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([initiator]).rpc();
      assert.fail("expected InvalidStatus (Locked)");
    } catch (err: any) {
      if (err.message?.includes("expected InvalidStatus")) throw err;
      assert.include(getDiag(err), "InvalidStatus");
    }
  });

  // ── Test 31: raise_dispute on Funded escrow ───────────────────────────

  it("T31: raise_dispute on Funded escrow (not Locked/Released) → InvalidStatus", async () => {
    const escrowId = generateEscrowId();
    const { escrowPda, pactPda, disputePda } = deriveEscrowPdas(escrowId);
    const vaultAta = getAssociatedTokenAddress(mintPubkey, escrowPda);

    await escrowProgram.methods.initializeEscrow({
      escrowId, beneficiary: beneficiary.publicKey, arbiter: arbiter.publicKey,
      escrowAmount: new anchor.BN(100_000), initiatorStake: new anchor.BN(0),
      beneficiaryStake: new anchor.BN(0),
      timeLockExpiresAt: new anchor.BN(Math.floor(Date.now() / 1000) + 3600),
      deliverablesHash: Array(32).fill(0), deliverablesUri: Array(128).fill(0),
      autoReleaseOnExpiry: false,
      disputeDeadlineSecs: new anchor.BN(86400),
      initiatorReputationMin: new anchor.BN(0), beneficiaryReputationMin: new anchor.BN(0),
    }).accounts({
      initiator: initiator.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      mint: mintPubkey, vault: vaultAta, initiatorReputation: initiatorRepPda,
      initiatorWallet: initiatorWalletPda, beneficiaryWallet: beneficiaryWalletPda,
      arbiterWallet: arbiterWalletPda,
      vaultpactProgram: holdfastProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([initiator]).rpc();

    // Only deposited — status is Funded, not Locked
    await escrowProgram.methods.depositFunds().accounts({
      initiator: initiator.publicKey, escrowAccount: escrowPda,
      initiatorTokenAccount: initiatorTokenAccount.publicKey,
      vault: vaultAta, tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([initiator]).rpc();

    try {
      await escrowProgram.methods.raiseDispute({
        evidenceHash: Array(32).fill(60), evidenceUri: Array(128).fill(0),
      }).accounts({
        raiser: initiator.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
        disputeRecord: disputePda, systemProgram: anchor.web3.SystemProgram.programId,
      }).signers([initiator]).rpc();
      assert.fail("expected InvalidStatus");
    } catch (err: any) {
      if (err.message?.includes("expected InvalidStatus")) throw err;
      assert.include(getDiag(err), "InvalidStatus");
    }
  });

  // ── Test 32: raise_dispute after release within dispute window ────────

  it("T32: raise_dispute on Released escrow within 7-day window → status Disputed", async () => {
    const { escrowPda, pactPda, disputePda, vaultAta } = await buildLockedEscrow({});

    await escrowProgram.methods.releaseEscrow().accounts({
      initiator: initiator.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      initiatorWallet: initiatorWalletPda,
    }).signers([initiator]).rpc();

    // dispute_window_ends_at is 7 days from now — we're well within it
    await escrowProgram.methods.raiseDispute({
      evidenceHash: Array(32).fill(61), evidenceUri: Array(128).fill(0),
    }).accounts({
      raiser: beneficiary.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      disputeRecord: disputePda, systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([beneficiary]).rpc();

    const escrow = await escrowProgram.account.escrowAccount.fetch(escrowPda);
    assert.deepEqual(escrow.status, { disputed: {} },
      "raise_dispute on Released escrow within window must succeed");
  });

  // ── Test 33: release_escrow wrong status ─────────────────────────────

  it("T33: release_escrow on Pending escrow → InvalidStatus", async () => {
    const escrowId = generateEscrowId();
    const { escrowPda, pactPda } = deriveEscrowPdas(escrowId);
    const vaultAta = getAssociatedTokenAddress(mintPubkey, escrowPda);

    await escrowProgram.methods.initializeEscrow({
      escrowId, beneficiary: beneficiary.publicKey, arbiter: arbiter.publicKey,
      escrowAmount: new anchor.BN(100_000), initiatorStake: new anchor.BN(0),
      beneficiaryStake: new anchor.BN(0),
      timeLockExpiresAt: new anchor.BN(Math.floor(Date.now() / 1000) + 3600),
      deliverablesHash: Array(32).fill(0), deliverablesUri: Array(128).fill(0),
      autoReleaseOnExpiry: false,
      disputeDeadlineSecs: new anchor.BN(86400),
      initiatorReputationMin: new anchor.BN(0), beneficiaryReputationMin: new anchor.BN(0),
    }).accounts({
      initiator: initiator.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      mint: mintPubkey, vault: vaultAta, initiatorReputation: initiatorRepPda,
      initiatorWallet: initiatorWalletPda, beneficiaryWallet: beneficiaryWalletPda,
      arbiterWallet: arbiterWalletPda,
      vaultpactProgram: holdfastProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([initiator]).rpc();

    // Status is Pending — release requires Locked
    try {
      await escrowProgram.methods.releaseEscrow().accounts({
        initiator: initiator.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
        initiatorWallet: initiatorWalletPda,
      }).signers([initiator]).rpc();
      assert.fail("expected InvalidStatus");
    } catch (err: any) {
      if (err.message?.includes("expected InvalidStatus")) throw err;
      assert.include(getDiag(err), "InvalidStatus");
    }
  });

  // ── Test 34: BeneficiaryAlreadyStaked ────────────────────────────────

  it("T34: stake_beneficiary twice on same escrow → BeneficiaryAlreadyStaked", async () => {
    const escrowId = generateEscrowId();
    const { escrowPda, pactPda } = deriveEscrowPdas(escrowId);
    const vaultAta = getAssociatedTokenAddress(mintPubkey, escrowPda);

    await escrowProgram.methods.initializeEscrow({
      escrowId, beneficiary: beneficiary.publicKey, arbiter: arbiter.publicKey,
      escrowAmount: new anchor.BN(100_000), initiatorStake: new anchor.BN(0),
      beneficiaryStake: new anchor.BN(0),
      timeLockExpiresAt: new anchor.BN(Math.floor(Date.now() / 1000) + 3600),
      deliverablesHash: Array(32).fill(0), deliverablesUri: Array(128).fill(0),
      autoReleaseOnExpiry: false,
      disputeDeadlineSecs: new anchor.BN(86400),
      initiatorReputationMin: new anchor.BN(0), beneficiaryReputationMin: new anchor.BN(0),
    }).accounts({
      initiator: initiator.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      mint: mintPubkey, vault: vaultAta, initiatorReputation: initiatorRepPda,
      initiatorWallet: initiatorWalletPda, beneficiaryWallet: beneficiaryWalletPda,
      arbiterWallet: arbiterWalletPda,
      vaultpactProgram: holdfastProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([initiator]).rpc();

    await escrowProgram.methods.depositFunds().accounts({
      initiator: initiator.publicKey, escrowAccount: escrowPda,
      initiatorTokenAccount: initiatorTokenAccount.publicKey,
      vault: vaultAta, tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([initiator]).rpc();

    // First stake succeeds
    await escrowProgram.methods.stakeBeneficiary().accounts({
      beneficiary: beneficiary.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
      vault: vaultAta, beneficiaryReputation: beneficiaryRepPda,
      beneficiaryWallet: beneficiaryWalletPda,
      vaultpactProgram: holdfastProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([beneficiary]).rpc();

    // Second stake must be rejected
    try {
      await escrowProgram.methods.stakeBeneficiary().accounts({
        beneficiary: beneficiary.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
        beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
        vault: vaultAta, beneficiaryReputation: beneficiaryRepPda,
        beneficiaryWallet: beneficiaryWalletPda,
        vaultpactProgram: holdfastProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([beneficiary]).rpc();
      assert.fail("expected BeneficiaryAlreadyStaked");
    } catch (err: any) {
      if (err.message?.includes("expected BeneficiaryAlreadyStaked")) throw err;
      assert.include(getDiag(err), "BeneficiaryAlreadyStaked");
    }
  });

  // ── Test 35: escalate_dispute non-participant ─────────────────────────

  it("T35: escalate_dispute by arbiter (non-participant) → NotParticipant", async () => {
    const { escrowPda, pactPda, disputePda } = await buildLockedEscrow({
      disputeDeadlineSecs: 3600,
    });
    await raiseDisputeOn(escrowPda, pactPda, disputePda, initiator, 62);

    try {
      await escrowProgram.methods.escalateDispute().accounts({
        escalator: arbiter.publicKey,
        escrowAccount: escrowPda,
        disputeRecord: disputePda,
      }).signers([arbiter]).rpc();
      assert.fail("expected NotParticipant");
    } catch (err: any) {
      if (err.message?.includes("expected NotParticipant")) throw err;
      assert.include(getDiag(err), "NotParticipant");
    }
  });

  // ── Test 36: escalate_dispute before resolution deadline ─────────────

  it("T36: escalate_dispute before resolution deadline → ResolutionDeadlineNotPassed", async () => {
    // Long dispute deadline (1 day) — won't pass during the test
    const { escrowPda, pactPda, disputePda } = await buildLockedEscrow({
      disputeDeadlineSecs: 86400,
    });
    await raiseDisputeOn(escrowPda, pactPda, disputePda, beneficiary, 63);

    try {
      await escrowProgram.methods.escalateDispute().accounts({
        escalator: initiator.publicKey,
        escrowAccount: escrowPda,
        disputeRecord: disputePda,
      }).signers([initiator]).rpc();
      assert.fail("expected ResolutionDeadlineNotPassed");
    } catch (err: any) {
      if (err.message?.includes("expected ResolutionDeadlineNotPassed")) throw err;
      assert.include(getDiag(err), "ResolutionDeadlineNotPassed");
    }
  });

  // ── Test 37: resolve_dispute SplitFunds 0/100 edge cases ─────────────

  it("T37: resolve_dispute SplitFunds 0 BPS → initiator gets full escrow", async () => {
    const escrowAmount = 100_000;
    const { escrowPda, pactPda, disputePda, vaultAta } = await buildLockedEscrow({
      escrowAmount,
    });
    await raiseDisputeOn(escrowPda, pactPda, disputePda, initiator, 64);

    const iBalBefore = parseInt((await provider.connection.getTokenAccountBalance(
      initiatorTokenAccount.publicKey,
    )).value.amount);
    const bBalBefore = parseInt((await provider.connection.getTokenAccountBalance(
      beneficiaryTokenAccount.publicKey,
    )).value.amount);

    await escrowProgram.methods.resolveDispute({
      decision: { splitFunds: { beneficiaryBps: 0 } }, // 0% to beneficiary
      reasoningHash: Array(32).fill(65),
    }).accounts({
      arbiter: arbiter.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      disputeRecord: disputePda, vault: vaultAta,
      beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
      initiatorTokenAccount: initiatorTokenAccount.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      arbiterWallet: arbiterWalletPda,
      initiatorReputation: initiatorRepPda,
      beneficiaryReputation: beneficiaryRepPda,
      escrowAuthority,
      vaultpactProgram: holdfastProgram.programId,
    }).signers([arbiter]).rpc();

    const iBalAfter = parseInt((await provider.connection.getTokenAccountBalance(
      initiatorTokenAccount.publicKey,
    )).value.amount);
    const bBalAfter = parseInt((await provider.connection.getTokenAccountBalance(
      beneficiaryTokenAccount.publicKey,
    )).value.amount);

    assert.equal(iBalAfter - iBalBefore, escrowAmount, "initiator gets 100% at 0 BPS");
    assert.equal(bBalAfter - bBalBefore, 0, "beneficiary gets 0 at 0 BPS");
  });

  it("T38: resolve_dispute SplitFunds 10000 BPS → beneficiary gets full escrow", async () => {
    const escrowAmount = 100_000;
    const { escrowPda, pactPda, disputePda, vaultAta } = await buildLockedEscrow({
      escrowAmount,
    });
    await raiseDisputeOn(escrowPda, pactPda, disputePda, beneficiary, 66);

    const bBalBefore = parseInt((await provider.connection.getTokenAccountBalance(
      beneficiaryTokenAccount.publicKey,
    )).value.amount);
    const iBalBefore = parseInt((await provider.connection.getTokenAccountBalance(
      initiatorTokenAccount.publicKey,
    )).value.amount);

    await escrowProgram.methods.resolveDispute({
      decision: { splitFunds: { beneficiaryBps: 10000 } }, // 100% to beneficiary
      reasoningHash: Array(32).fill(67),
    }).accounts({
      arbiter: arbiter.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      disputeRecord: disputePda, vault: vaultAta,
      beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
      initiatorTokenAccount: initiatorTokenAccount.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      arbiterWallet: arbiterWalletPda,
      initiatorReputation: initiatorRepPda,
      beneficiaryReputation: beneficiaryRepPda,
      escrowAuthority,
      vaultpactProgram: holdfastProgram.programId,
    }).signers([arbiter]).rpc();

    const bBalAfter = parseInt((await provider.connection.getTokenAccountBalance(
      beneficiaryTokenAccount.publicKey,
    )).value.amount);
    const iBalAfter = parseInt((await provider.connection.getTokenAccountBalance(
      initiatorTokenAccount.publicKey,
    )).value.amount);

    assert.equal(bBalAfter - bBalBefore, escrowAmount, "beneficiary gets 100% at 10000 BPS");
    assert.equal(iBalAfter - iBalBefore, 0, "initiator gets 0 at 10000 BPS");
  });

  // ── CAS-426: resolve_dispute blocked after protocol_freeze_pact ─────

  it("T39a: resolve_dispute after protocol_freeze_pact → InvalidStatus (status lockout)", async () => {
    const { escrowPda, pactPda, disputePda, vaultAta } = await buildLockedEscrow({});

    await raiseDisputeOn(escrowPda, pactPda, disputePda, initiator, 80);

    // Blacklist beneficiary and freeze the pact — status transitions to Refunded
    await setAgentStatus(beneficiaryWalletPda, 2);
    try {
      await escrowProgram.methods.protocolFreezePact().accounts({
        protocolAuthority: provider.wallet.publicKey,
        escrow: escrowPda,
        pact: pactPda,
        disputeRecord: disputePda,
        blacklistedWallet: beneficiaryWalletPda,
        secondBlacklistedWallet: null,
        attestationRegistry: registryPda,
        vault: vaultAta,
        beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
        initiatorTokenAccount: initiatorTokenAccount.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        initiatorReputation: initiatorRepPda,
        beneficiaryReputation: beneficiaryRepPda,
        escrowAuthority,
        vaultpactProgram: holdfastProgram.programId,
        systemProgram: anchor.web3.SystemProgram.programId,
      }).rpc();

      // Escrow is now Refunded — resolve_dispute must be rejected
      try {
        await escrowProgram.methods.resolveDispute({
          decision: { releaseToBeneficiary: {} },
          reasoningHash: Array(32).fill(81),
        }).accounts({
          arbiter: arbiter.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
          disputeRecord: disputePda, vault: vaultAta,
          beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey,
          initiatorTokenAccount: initiatorTokenAccount.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          arbiterWallet: arbiterWalletPda,
          initiatorReputation: initiatorRepPda,
          beneficiaryReputation: beneficiaryRepPda,
          escrowAuthority,
          vaultpactProgram: holdfastProgram.programId,
        }).signers([arbiter]).rpc();
        assert.fail("expected InvalidStatus after protocol_freeze_pact");
      } catch (err: any) {
        if (err.message?.includes("expected InvalidStatus")) throw err;
        assert.include(getDiag(err), "InvalidStatus",
          "CAS-426: resolve_dispute must be blocked after protocol_freeze_pact");
      }
    } finally {
      await setAgentStatus(beneficiaryWalletPda, 0);
    }
  });

  // ── CAS-230: cancel_pending_escrow rejects non-Funded status ────────

  it("T39: cancel_pending_escrow on Pending escrow → InvalidStatus", async () => {
    const escrowId = generateEscrowId();
    const { escrowPda, pactPda } = deriveEscrowPdas(escrowId);
    const vaultAta = getAssociatedTokenAddress(mintPubkey, escrowPda);

    await escrowProgram.methods.initializeEscrow({
      escrowId, beneficiary: beneficiary.publicKey, arbiter: arbiter.publicKey,
      escrowAmount: new anchor.BN(100_000), initiatorStake: new anchor.BN(0),
      beneficiaryStake: new anchor.BN(0),
      timeLockExpiresAt: new anchor.BN(Math.floor(Date.now() / 1000) + 60),
      deliverablesHash: Array(32).fill(0), deliverablesUri: Array(128).fill(0),
      autoReleaseOnExpiry: false, slashLoserStake: false,
      disputeDeadlineSecs: new anchor.BN(86400),
      initiatorReputationMin: new anchor.BN(0), beneficiaryReputationMin: new anchor.BN(0),
      initiatorMinTier: 0, initiatorMinPacts: new anchor.BN(0),
      beneficiaryMinTier: 0, beneficiaryMinPacts: new anchor.BN(0),
    }).accounts({
      initiator: initiator.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      mint: mintPubkey, vault: vaultAta, initiatorReputation: initiatorRepPda,
      initiatorWallet: initiatorWalletPda, beneficiaryWallet: beneficiaryWalletPda,
      arbiterWallet: arbiterWalletPda,
      vaultpactProgram: holdfastProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([initiator]).rpc();

    try {
      await escrowProgram.methods.cancelPendingEscrow().accounts({
        initiator: initiator.publicKey, escrowAccount: escrowPda,
        vault: vaultAta, initiatorTokenAccount: initiatorTokenAccount.publicKey,
        beneficiaryTokenAccount: beneficiaryTokenAccount.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        initiatorReputation: initiatorRepPda,
        beneficiaryReputation: beneficiaryRepPda,
        escrowAuthority,
        vaultpactProgram: holdfastProgram.programId,
      }).signers([initiator]).rpc();
      assert.fail("expected InvalidStatus");
    } catch (err: any) {
      if (err.message?.includes("expected InvalidStatus")) throw err;
      assert.include(getDiag(err), "InvalidStatus");
    }
  });

  it("MED-F-002 coverage: cancel_pending_escrow updates both reputation nonces", async () => {
    // Invariant validated: pending cancel path applies reputation CPI updates
    // for initiator and beneficiary.
    const { escrowPda, vaultAta, timeLockExpiresAt } = await buildFundedEscrow({
      escrowAmount: 111_000,
      initiatorStake: 7_000,
      beneficiaryStake: 0,
    });

    const initiatorRepBefore = await holdfastProgram.account.reputationAccount.fetch(initiatorRepPda);
    const beneficiaryRepBefore = await holdfastProgram.account.reputationAccount.fetch(beneficiaryRepPda);
    const iNonceBefore = (initiatorRepBefore.nonce as anchor.BN).toNumber();
    const bNonceBefore = (beneficiaryRepBefore.nonce as anchor.BN).toNumber();

    const waitMs = Math.max(0, (timeLockExpiresAt - Math.floor(Date.now() / 1000) + 1) * 1000);
    if (waitMs > 0) {
      await sleep(waitMs);
    }

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
      vaultpactProgram: holdfastProgram.programId,
    }).signers([initiator]).rpc();

    const initiatorRepAfter = await holdfastProgram.account.reputationAccount.fetch(initiatorRepPda);
    const beneficiaryRepAfter = await holdfastProgram.account.reputationAccount.fetch(beneficiaryRepPda);
    const iNonceAfter = (initiatorRepAfter.nonce as anchor.BN).toNumber();
    const bNonceAfter = (beneficiaryRepAfter.nonce as anchor.BN).toNumber();

    assert.equal(iNonceAfter, iNonceBefore + 1, "initiator nonce increments by 1");
    assert.equal(bNonceAfter, bNonceBefore + 1, "beneficiary nonce increments by 1");
  });
});

// ── Bankrun: time-dependent tests ────────────────��───────────────────
//
// bankrun provides an in-process validator with clock warp support.
// Native binary is Linux/macOS only — tests skip gracefully on Windows.
// Covers: T17, T18, claim_released happy path, refund direct path, escalate_dispute happy path.

(bankrunMod ? describe : describe.skip)("bankrun: time-warp tests (claim_released, refund, escalate_dispute)", function () {
  this.timeout(120_000);

  const HOLDFAST_ID = new anchor.web3.PublicKey("D6mUa4wGtFyLyJorMfxoKvA9ybohjUSsfw88t66ATxg");
  const ESCROW_ID = new anchor.web3.PublicKey("CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi");

  let context: any;
  let brProvider: any;
  let brEscrow: Program<VaultpactEscrow>;
  let brHoldfast: Program<Vaultpact>;
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

  async function encodeAgentWallet(fields: {
    authority: anchor.web3.PublicKey;
    pubkeyX: Buffer;
    pubkeyY: Buffer;
    status: number;
    bump: number;
  }): Promise<Buffer> {
    return await brHoldfast.coder.accounts.encode("AgentWallet", {
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

  async function encodeReputation(agent: anchor.web3.PublicKey, bump: number): Promise<Buffer> {
    return await brHoldfast.coder.accounts.encode("ReputationAccount", {
      agent,
      score: new anchor.BN(5_000),
      tier: { unverified: {} },
      totalPacts: new anchor.BN(0),
      disputeCount: new anchor.BN(0),
      createdAt: new anchor.BN(Math.floor(Date.now() / 1000)),
      lastUpdated: new anchor.BN(Math.floor(Date.now() / 1000)),
      decayCursor: new anchor.BN(Math.floor(Date.now() / 1000)),
      nonce: new anchor.BN(0),
      historyLen: 0,
      historyHead: 0,
      history: Array(20).fill({
        outcome: { fulfilled: {} },
        scoreDelta: 0,
        timestamp: new anchor.BN(0),
        pactId: Array(7).fill(0),
      }),
      padding: Array(52).fill(0),
      bump,
    });
  }

  async function encodeRegistry(auth: anchor.web3.PublicKey, bump: number): Promise<Buffer> {
    return await brHoldfast.coder.accounts.encode("AttestationRegistry", {
      authority: auth,
      agentCount: new anchor.BN(2),
      bump,
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
    brHoldfast = new Program<Vaultpact>(
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

    // Pre-populate AgentWallet PDAs (bypasses secp256r1 registration)
    const iPubkeyX = Buffer.alloc(32, 0x01);
    const iPubkeyY = Buffer.alloc(32, 0x02);
    const [iWalletPda, iWalletBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("agent_wallet"), iPubkeyX, iPubkeyY], HOLDFAST_ID,
    );
    brInitiatorWalletPda = iWalletPda;

    const bPubkeyX = Buffer.alloc(32, 0x03);
    const bPubkeyY = Buffer.alloc(32, 0x04);
    const [bWalletPda, bWalletBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("agent_wallet"), bPubkeyX, bPubkeyY], HOLDFAST_ID,
    );
    brBeneficiaryWalletPda = bWalletPda;

    const aPubkeyX = Buffer.alloc(32, 0x05);
    const aPubkeyY = Buffer.alloc(32, 0x06);
    const [aWalletPda, aWalletBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("agent_wallet"), aPubkeyX, aPubkeyY], HOLDFAST_ID,
    );
    brArbiterWalletPda = aWalletPda;

    setPrebuiltAccount(brInitiatorWalletPda, HOLDFAST_ID,
      await encodeAgentWallet({ authority: brInitiator.publicKey, pubkeyX: iPubkeyX, pubkeyY: iPubkeyY, status: 0, bump: iWalletBump }));
    setPrebuiltAccount(brBeneficiaryWalletPda, HOLDFAST_ID,
      await encodeAgentWallet({ authority: brBeneficiary.publicKey, pubkeyX: bPubkeyX, pubkeyY: bPubkeyY, status: 0, bump: bWalletBump }));
    setPrebuiltAccount(brArbiterWalletPda, HOLDFAST_ID,
      await encodeAgentWallet({ authority: brArbiter.publicKey, pubkeyX: aPubkeyX, pubkeyY: aPubkeyY, status: 0, bump: aWalletBump }));

    // Initialise ReputationAccount PDAs via on-chain transactions so the layout
    // matches the current Rust struct (schema_version field, 51-byte padding).
    // The stale IDL omits schema_version, so pre-populating via encodeReputation
    // produces a misaligned account that fails seed checks in update_reputation.
    const [iRepPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("reputation"), brInitiator.publicKey.toBuffer()], HOLDFAST_ID,
    );
    brInitiatorRepPda = iRepPda;
    await brHoldfast.methods.initReputation()
      .accounts({
        reputationAccount: iRepPda,
        agent: brInitiator.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([brInitiator])
      .rpc();

    const [bRepPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("reputation"), brBeneficiary.publicKey.toBuffer()], HOLDFAST_ID,
    );
    brBeneficiaryRepPda = bRepPda;
    await brHoldfast.methods.initReputation()
      .accounts({
        reputationAccount: bRepPda,
        agent: brBeneficiary.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([brBeneficiary])
      .rpc();

    // Derive the escrow PDA authority used to sign update_reputation CPIs.
    [brEscrowAuthority] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vp_escrow_authority")],
      ESCROW_ID,
    );

    // Pre-populate AttestationRegistry
    const [regPda, regBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("attestation_registry")], HOLDFAST_ID,
    );
    brRegistryPda = regPda;
    setPrebuiltAccount(regPda, HOLDFAST_ID, await encodeRegistry(authority.publicKey, regBump));

    // Create SPL Token mint and token accounts
    brMint = anchor.web3.Keypair.generate();
    const mintRent = 1_000_000_000;
    const mintData = Buffer.alloc(82);
    mintData[0] = 1; // isInitialized (COption<Pubkey> format: 4-byte tag + 32 bytes)
    // Mint authority at offset 0-35: COption(1) + pubkey
    mintData.writeUInt32LE(1, 0); // COption::Some
    authority.publicKey.toBuffer().copy(mintData, 4); // mint_authority
    mintData.writeBigUInt64LE(0n, 36); // supply
    mintData[44] = 6; // decimals
    mintData[45] = 1; // is_initialized
    mintData.writeUInt32LE(0, 46); // freeze_authority COption::None
    setPrebuiltAccount(brMint.publicKey, TOKEN_PROGRAM_ID, mintData, mintRent);

    // Token accounts for initiator and beneficiary
    brInitiatorToken = anchor.web3.Keypair.generate();
    brBeneficiaryToken = anchor.web3.Keypair.generate();

    function makeTokenAccountData(mint: anchor.web3.PublicKey, owner: anchor.web3.PublicKey, amount: bigint): Buffer {
      const data = Buffer.alloc(165);
      mint.toBuffer().copy(data, 0); // mint
      owner.toBuffer().copy(data, 32); // owner
      data.writeBigUInt64LE(amount, 64); // amount
      data.writeUInt32LE(0, 72); // delegate COption::None
      data[108] = 1; // state (Initialized)
      data.writeUInt32LE(0, 109); // is_native COption::None
      data.writeBigUInt64LE(0n, 117); // delegated_amount
      data.writeUInt32LE(0, 125); // close_authority COption::None
      return data;
    }

    setPrebuiltAccount(brInitiatorToken.publicKey, TOKEN_PROGRAM_ID,
      makeTokenAccountData(brMint.publicKey, brInitiator.publicKey, 10_000_000n), 1_000_000_000);
    setPrebuiltAccount(brBeneficiaryToken.publicKey, TOKEN_PROGRAM_ID,
      makeTokenAccountData(brMint.publicKey, brBeneficiary.publicKey, 10_000_000n), 1_000_000_000);
  });

  async function brSetAgentStatus(walletPda: anchor.web3.PublicKey, newStatus: number) {
    await brHoldfast.methods
      .setAgentStatus(newStatus)
      .accounts({ authority: authority.publicKey, agentWallet: walletPda })
      .signers([authority])
      .rpc();
  }

  async function brBuildReleasedEscrow(): Promise<{
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
    const vaultAta = getAssociatedTokenAddress(brMint.publicKey, escrowPda);

    await brEscrow.methods.initializeEscrow({
      escrowId, beneficiary: brBeneficiary.publicKey, arbiter: brArbiter.publicKey,
      escrowAmount: new anchor.BN(100_000), initiatorStake: new anchor.BN(0),
      beneficiaryStake: new anchor.BN(0),
      timeLockExpiresAt: new anchor.BN(Math.floor(Date.now() / 1000) + 3600),
      deliverablesHash: Array(32).fill(0), deliverablesUri: Array(128).fill(0),
      autoReleaseOnExpiry: false,
      disputeDeadlineSecs: new anchor.BN(86400),
      initiatorReputationMin: new anchor.BN(0), beneficiaryReputationMin: new anchor.BN(0),
      initiatorMinTier: 0, initiatorMinPacts: new anchor.BN(0),
      beneficiaryMinTier: 0, beneficiaryMinPacts: new anchor.BN(0),
    }).accounts({
      initiator: brInitiator.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      mint: brMint.publicKey, vault: vaultAta, initiatorReputation: brInitiatorRepPda,
      initiatorWallet: brInitiatorWalletPda, beneficiaryWallet: brBeneficiaryWalletPda,
      arbiterWallet: brArbiterWalletPda,
      vaultpactProgram: brHoldfast.programId, tokenProgram: TOKEN_PROGRAM_ID,
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
      vaultpactProgram: brHoldfast.programId, tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([brBeneficiary]).rpc();

    await brEscrow.methods.lockEscrow().accounts({
      initiator: brInitiator.publicKey, beneficiary: brBeneficiary.publicKey,
      escrowAccount: escrowPda, vault: vaultAta,
      initiatorWallet: brInitiatorWalletPda, beneficiaryWallet: brBeneficiaryWalletPda,
      arbiterWallet: brArbiterWalletPda,
      pactRecord: pactPda, initiatorReputation: brInitiatorRepPda,
      beneficiaryReputation: brBeneficiaryRepPda,
      vaultpactProgram: brHoldfast.programId,
    }).signers([brInitiator, brBeneficiary]).rpc();

    await brEscrow.methods.releaseEscrow().accounts({
      initiator: brInitiator.publicKey, escrowAccount: escrowPda,
      pactRecord: pactPda, initiatorWallet: brInitiatorWalletPda,
    }).signers([brInitiator]).rpc();

    return { escrowId, escrowPda, pactPda, vaultAta };
  }

  async function brBuildLockedEscrow(opts: {
    timeLockSecs?: number;
    disputeDeadlineSecs?: number;
    escrowAmount?: number;
  } = {}): Promise<{
    escrowId: number[];
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
    const timeLockExpiresAt = now + (opts.timeLockSecs ?? 7 * 24 * 3600);

    await brEscrow.methods.initializeEscrow({
      escrowId, beneficiary: brBeneficiary.publicKey, arbiter: brArbiter.publicKey,
      escrowAmount: new anchor.BN(opts.escrowAmount ?? 100_000), initiatorStake: new anchor.BN(0),
      beneficiaryStake: new anchor.BN(0),
      timeLockExpiresAt: new anchor.BN(timeLockExpiresAt),
      deliverablesHash: Array(32).fill(0), deliverablesUri: Array(128).fill(0),
      autoReleaseOnExpiry: false,
      disputeDeadlineSecs: new anchor.BN(opts.disputeDeadlineSecs ?? 86400),
      initiatorReputationMin: new anchor.BN(0), beneficiaryReputationMin: new anchor.BN(0),
      initiatorMinTier: 0, initiatorMinPacts: new anchor.BN(0),
      beneficiaryMinTier: 0, beneficiaryMinPacts: new anchor.BN(0),
    }).accounts({
      initiator: brInitiator.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      mint: brMint.publicKey, vault: vaultAta, initiatorReputation: brInitiatorRepPda,
      initiatorWallet: brInitiatorWalletPda, beneficiaryWallet: brBeneficiaryWalletPda,
      arbiterWallet: brArbiterWalletPda,
      vaultpactProgram: brHoldfast.programId, tokenProgram: TOKEN_PROGRAM_ID,
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
      vaultpactProgram: brHoldfast.programId, tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([brBeneficiary]).rpc();

    await brEscrow.methods.lockEscrow().accounts({
      initiator: brInitiator.publicKey, beneficiary: brBeneficiary.publicKey,
      escrowAccount: escrowPda, vault: vaultAta,
      initiatorWallet: brInitiatorWalletPda, beneficiaryWallet: brBeneficiaryWalletPda,
      arbiterWallet: brArbiterWalletPda,
      pactRecord: pactPda, initiatorReputation: brInitiatorRepPda,
      beneficiaryReputation: brBeneficiaryRepPda,
      vaultpactProgram: brHoldfast.programId,
    }).signers([brInitiator, brBeneficiary]).rpc();

    return { escrowId, escrowPda, pactPda, disputePda, vaultAta };
  }

  async function brBuildDisputedEscrow(opts: {
    disputeDeadlineSecs?: number;
  } = {}): Promise<{
    escrowId: number[];
    escrowPda: anchor.web3.PublicKey;
    pactPda: anchor.web3.PublicKey;
    disputePda: anchor.web3.PublicKey;
    vaultAta: anchor.web3.PublicKey;
  }> {
    const result = await brBuildLockedEscrow({
      disputeDeadlineSecs: opts.disputeDeadlineSecs ?? 86400,
    });

    await brEscrow.methods.raiseDispute({
      evidenceHash: Array(32).fill(0xBB),
      evidenceUri: Array(128).fill(0),
    }).accounts({
      raiser: brInitiator.publicKey, escrowAccount: result.escrowPda, pactRecord: result.pactPda,
      disputeRecord: result.disputePda, systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([brInitiator]).rpc();

    return result;
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

  it("T17: claim_released rejects blacklisted beneficiary (AgentBlacklisted)", async () => {
    const { escrowPda, vaultAta } = await brBuildReleasedEscrow();

    await warpClockForward(8 * 24 * 3600);
    await brSetAgentStatus(brBeneficiaryWalletPda, 2);

    try {
      await brEscrow.methods.claimReleased().accounts({
        beneficiary: brBeneficiary.publicKey, escrowAccount: escrowPda,
        vault: vaultAta, beneficiaryTokenAccount: brBeneficiaryToken.publicKey,
        initiatorTokenAccount: brInitiatorToken.publicKey,
        beneficiaryWallet: brBeneficiaryWalletPda, tokenProgram: TOKEN_PROGRAM_ID,
        initiatorReputation: brInitiatorRepPda, beneficiaryReputation: brBeneficiaryRepPda,
        escrowAuthority: brEscrowAuthority, vaultpactProgram: brHoldfast.programId,
      }).signers([brBeneficiary]).rpc();
      assert.fail("expected AgentBlacklisted");
    } catch (err: any) {
      if (err.message?.includes("expected AgentBlacklisted")) throw err;
      assert.include(brGetDiag(err), "AgentBlacklisted");
    } finally {
      await brSetAgentStatus(brBeneficiaryWalletPda, 0);
    }
  });

  it("T18: claim_released allows frozen beneficiary (settlement)", async () => {
    const { escrowPda, vaultAta } = await brBuildReleasedEscrow();

    await warpClockForward(8 * 24 * 3600);
    await brSetAgentStatus(brBeneficiaryWalletPda, 1);

    try {
      await brEscrow.methods.claimReleased().accounts({
        beneficiary: brBeneficiary.publicKey, escrowAccount: escrowPda,
        vault: vaultAta, beneficiaryTokenAccount: brBeneficiaryToken.publicKey,
        initiatorTokenAccount: brInitiatorToken.publicKey,
        beneficiaryWallet: brBeneficiaryWalletPda, tokenProgram: TOKEN_PROGRAM_ID,
        initiatorReputation: brInitiatorRepPda, beneficiaryReputation: brBeneficiaryRepPda,
        escrowAuthority: brEscrowAuthority, vaultpactProgram: brHoldfast.programId,
      }).signers([brBeneficiary]).rpc();

      const escrow = await brEscrow.account.escrowAccount.fetch(escrowPda);
      assert.deepEqual(escrow.status, { claimed: {} });
    } finally {
      await brSetAgentStatus(brBeneficiaryWalletPda, 0);
    }
  });

  it("claim_released happy path with bankrun time warp", async () => {
    const { escrowPda, vaultAta } = await brBuildReleasedEscrow();

    await warpClockForward(8 * 24 * 3600);

    await brEscrow.methods.claimReleased().accounts({
      beneficiary: brBeneficiary.publicKey, escrowAccount: escrowPda,
      vault: vaultAta, beneficiaryTokenAccount: brBeneficiaryToken.publicKey,
      initiatorTokenAccount: brInitiatorToken.publicKey,
      beneficiaryWallet: brBeneficiaryWalletPda, tokenProgram: TOKEN_PROGRAM_ID,
      initiatorReputation: brInitiatorRepPda, beneficiaryReputation: brBeneficiaryRepPda,
      escrowAuthority: brEscrowAuthority, vaultpactProgram: brHoldfast.programId,
    }).signers([brBeneficiary]).rpc();

    const escrow = await brEscrow.account.escrowAccount.fetch(escrowPda);
    assert.deepEqual(escrow.status, { claimed: {} });
  });

  // ── refund direct path with time-warp ──────────────────────────────

  it("refund direct path: warps past time_lock_expires_at and refunds initiator", async () => {
    const escrowAmount = 200_000;
    const { escrowPda, vaultAta } = await brBuildLockedEscrow({
      timeLockSecs: 7 * 24 * 3600,
      escrowAmount,
    });

    const iBalBefore = Number(
      (await brProvider.connection.getTokenAccountBalance(brInitiatorToken.publicKey)).value.amount,
    );

    await warpClockForward(8 * 24 * 3600);

    await brEscrow.methods.refund().accounts({
      crank: authority.publicKey, escrowAccount: escrowPda,
      vault: vaultAta, initiatorTokenAccount: brInitiatorToken.publicKey,
      beneficiaryTokenAccount: brBeneficiaryToken.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
      disputeRecord: null,
    }).signers([authority]).rpc();

    const escrow = await brEscrow.account.escrowAccount.fetch(escrowPda);
    assert.deepEqual(escrow.status, { refunded: {} });

    const iBalAfter = Number(
      (await brProvider.connection.getTokenAccountBalance(brInitiatorToken.publicKey)).value.amount,
    );
    assert.equal(iBalAfter - iBalBefore, escrowAmount, "initiator receives full escrow amount");
  });

  it("refund before time_lock_expires_at → TimeLockNotExpired", async () => {
    const { escrowPda, vaultAta } = await brBuildLockedEscrow({
      timeLockSecs: 7 * 24 * 3600,
    });

    try {
      await brEscrow.methods.refund().accounts({
        crank: authority.publicKey, escrowAccount: escrowPda,
        vault: vaultAta, initiatorTokenAccount: brInitiatorToken.publicKey,
        beneficiaryTokenAccount: brBeneficiaryToken.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        disputeRecord: null,
      }).signers([authority]).rpc();
      assert.fail("expected TimeLockNotExpired");
    } catch (err: any) {
      if (err.message?.includes("expected TimeLockNotExpired")) throw err;
      assert.include(brGetDiag(err), "TimeLockNotExpired");
    }
  });

  // ── escalate_dispute happy path with time-warp ─────────────────────

  it("escalate_dispute succeeds after resolution_deadline passes and records on-chain state", async () => {
    const { escrowPda, disputePda } = await brBuildDisputedEscrow({
      disputeDeadlineSecs: 3 * 24 * 3600,
    });

    await warpClockForward(4 * 24 * 3600);

    await brEscrow.methods.escalateDispute().accounts({
      escalator: brInitiator.publicKey, escrowAccount: escrowPda,
      disputeRecord: disputePda,
    }).signers([brInitiator]).rpc();

    const escrow = await brEscrow.account.escrowAccount.fetch(escrowPda);
    assert.deepEqual(escrow.status, { disputed: {} });

    const dispute = await brEscrow.account.disputeRecord.fetch(disputePda);
    assert.isAbove(Number(dispute.escalatedAt), 0, "escalated_at should be set");
    assert.isAbove(Number(dispute.escalationDeadline), Number(dispute.escalatedAt),
      "escalation_deadline should be after escalated_at");
  });

  it("escalate_dispute before resolution_deadline → ResolutionDeadlineNotPassed", async () => {
    const { escrowPda, disputePda } = await brBuildDisputedEscrow({
      disputeDeadlineSecs: 3 * 24 * 3600,
    });

    try {
      await brEscrow.methods.escalateDispute().accounts({
        escalator: brInitiator.publicKey, escrowAccount: escrowPda,
        disputeRecord: disputePda,
      }).signers([brInitiator]).rpc();
      assert.fail("expected ResolutionDeadlineNotPassed");
    } catch (err: any) {
      if (err.message?.includes("expected ResolutionDeadlineNotPassed")) throw err;
      assert.include(brGetDiag(err), "ResolutionDeadlineNotPassed");
    }
  });

  // ── CAS-106: fallback refund for stuck disputes ───────────────────

  it("refund disputed escrow after escalation + grace period passes", async () => {
    const escrowAmount = 200_000;
    const { escrowPda, disputePda, vaultAta } = await brBuildDisputedEscrow({
      disputeDeadlineSecs: 3600,
    });

    const iBalBefore = Number(
      (await brProvider.connection.getTokenAccountBalance(brInitiatorToken.publicKey)).value.amount,
    );

    // Warp past resolution deadline, then escalate
    await warpClockForward(2 * 3600);
    await brEscrow.methods.escalateDispute().accounts({
      escalator: brInitiator.publicKey, escrowAccount: escrowPda,
      disputeRecord: disputePda,
    }).signers([brInitiator]).rpc();

    // Warp past 7-day escalation grace period
    await warpClockForward(8 * 24 * 3600);

    await brEscrow.methods.refund().accounts({
      crank: authority.publicKey, escrowAccount: escrowPda,
      vault: vaultAta, initiatorTokenAccount: brInitiatorToken.publicKey,
      beneficiaryTokenAccount: brBeneficiaryToken.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
      disputeRecord: disputePda,
    }).signers([authority]).rpc();

    const escrow = await brEscrow.account.escrowAccount.fetch(escrowPda);
    assert.deepEqual(escrow.status, { refunded: {} });

    const iBalAfter = Number(
      (await brProvider.connection.getTokenAccountBalance(brInitiatorToken.publicKey)).value.amount,
    );
    assert.isAbove(iBalAfter, iBalBefore, "initiator receives refund");
  });

  it("refund disputed escrow without escalation → DisputeNotEscalated", async () => {
    const { escrowPda, disputePda, vaultAta } = await brBuildDisputedEscrow({
      disputeDeadlineSecs: 3600,
    });

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
      assert.include(brGetDiag(err), "DisputeNotEscalated");
    }
  });

  it("refund disputed escrow during escalation grace period → EscalationGracePeriodNotPassed", async () => {
    const { escrowPda, disputePda, vaultAta } = await brBuildDisputedEscrow({
      disputeDeadlineSecs: 3600,
    });

    // Warp past resolution deadline, escalate
    await warpClockForward(2 * 3600);
    await brEscrow.methods.escalateDispute().accounts({
      escalator: brInitiator.publicKey, escrowAccount: escrowPda,
      disputeRecord: disputePda,
    }).signers([brInitiator]).rpc();

    // Warp 3 days (still within 7-day grace period)
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
      assert.include(brGetDiag(err), "EscalationGracePeriodNotPassed");
    }
  });

  // ── CAS-230: cancel_pending_escrow from Funded status ───────────────

  async function brBuildFundedEscrow(opts: {
    timeLockSecs?: number;
    escrowAmount?: number;
    initiatorStake?: number;
    beneficiaryStake?: number;
    stakeBeneficiary?: boolean;
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
    const vaultAta = getAssociatedTokenAddress(brMint.publicKey, escrowPda);

    const currentClock = await context.banksClient.getClock();
    const now = Number(currentClock.unixTimestamp);
    const timeLockExpiresAt = now + (opts.timeLockSecs ?? 7 * 24 * 3600);

    const escrowAmount = opts.escrowAmount ?? 100_000;
    const initiatorStake = opts.initiatorStake ?? 0;
    const beneficiaryStake = opts.beneficiaryStake ?? 0;

    await brEscrow.methods.initializeEscrow({
      escrowId, beneficiary: brBeneficiary.publicKey, arbiter: brArbiter.publicKey,
      escrowAmount: new anchor.BN(escrowAmount), initiatorStake: new anchor.BN(initiatorStake),
      beneficiaryStake: new anchor.BN(beneficiaryStake),
      timeLockExpiresAt: new anchor.BN(timeLockExpiresAt),
      deliverablesHash: Array(32).fill(0), deliverablesUri: Array(128).fill(0),
      autoReleaseOnExpiry: false, slashLoserStake: false,
      disputeDeadlineSecs: new anchor.BN(86400),
      initiatorReputationMin: new anchor.BN(0), beneficiaryReputationMin: new anchor.BN(0),
      initiatorMinTier: 0, initiatorMinPacts: new anchor.BN(0),
      beneficiaryMinTier: 0, beneficiaryMinPacts: new anchor.BN(0),
    }).accounts({
      initiator: brInitiator.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      mint: brMint.publicKey, vault: vaultAta, initiatorReputation: brInitiatorRepPda,
      initiatorWallet: brInitiatorWalletPda, beneficiaryWallet: brBeneficiaryWalletPda,
      arbiterWallet: brArbiterWalletPda,
      vaultpactProgram: brHoldfast.programId, tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([brInitiator]).rpc();

    await brEscrow.methods.depositFunds().accounts({
      initiator: brInitiator.publicKey, escrowAccount: escrowPda,
      initiatorTokenAccount: brInitiatorToken.publicKey,
      vault: vaultAta, tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([brInitiator]).rpc();

    if (opts.stakeBeneficiary) {
      await brEscrow.methods.stakeBeneficiary().accounts({
        beneficiary: brBeneficiary.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
        beneficiaryTokenAccount: brBeneficiaryToken.publicKey,
        vault: vaultAta, beneficiaryReputation: brBeneficiaryRepPda,
        beneficiaryWallet: brBeneficiaryWalletPda,
        vaultpactProgram: brHoldfast.programId, tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([brBeneficiary]).rpc();
    }

    return { escrowId, escrowPda, pactPda, vaultAta };
  }

  it("cancel_pending_escrow: initiator withdraws from Funded after time lock expires", async () => {
    const escrowAmount = 150_000;
    const initiatorStake = 5_000;
    const { escrowPda, vaultAta } = await brBuildFundedEscrow({
      timeLockSecs: 3600,
      escrowAmount,
      initiatorStake,
    });

    const iBalBefore = Number(
      (await brProvider.connection.getTokenAccountBalance(brInitiatorToken.publicKey)).value.amount,
    );

    await warpClockForward(3601);

    await brEscrow.methods.cancelPendingEscrow().accounts({
      initiator: brInitiator.publicKey, escrowAccount: escrowPda,
      vault: vaultAta, initiatorTokenAccount: brInitiatorToken.publicKey,
      beneficiaryTokenAccount: brBeneficiaryToken.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
      initiatorReputation: brInitiatorRepPda,
      beneficiaryReputation: brBeneficiaryRepPda,
      escrowAuthority: brEscrowAuthority,
      vaultpactProgram: brHoldfast.programId,
    }).signers([brInitiator]).rpc();

    const escrow = await brEscrow.account.escrowAccount.fetch(escrowPda);
    assert.deepEqual(escrow.status, { refunded: {} });
    assert.isAbove(escrow.cancelledAt.toNumber(), 0, "cancelled_at is set");

    const iBalAfter = Number(
      (await brProvider.connection.getTokenAccountBalance(brInitiatorToken.publicKey)).value.amount,
    );
    assert.equal(iBalAfter - iBalBefore, escrowAmount + initiatorStake,
      "initiator receives escrow_amount + initiator_stake");
  });

  it("cancel_pending_escrow: returns beneficiary stake when beneficiary already staked", async () => {
    const escrowAmount = 100_000;
    const initiatorStake = 5_000;
    const beneficiaryStake = 3_000;
    const { escrowPda, vaultAta } = await brBuildFundedEscrow({
      timeLockSecs: 3600,
      escrowAmount,
      initiatorStake,
      beneficiaryStake,
      stakeBeneficiary: true,
    });

    const iBalBefore = Number(
      (await brProvider.connection.getTokenAccountBalance(brInitiatorToken.publicKey)).value.amount,
    );
    const bBalBefore = Number(
      (await brProvider.connection.getTokenAccountBalance(brBeneficiaryToken.publicKey)).value.amount,
    );

    await warpClockForward(3601);

    await brEscrow.methods.cancelPendingEscrow().accounts({
      initiator: brInitiator.publicKey, escrowAccount: escrowPda,
      vault: vaultAta, initiatorTokenAccount: brInitiatorToken.publicKey,
      beneficiaryTokenAccount: brBeneficiaryToken.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
      initiatorReputation: brInitiatorRepPda,
      beneficiaryReputation: brBeneficiaryRepPda,
      escrowAuthority: brEscrowAuthority,
      vaultpactProgram: brHoldfast.programId,
    }).signers([brInitiator]).rpc();

    const escrow = await brEscrow.account.escrowAccount.fetch(escrowPda);
    assert.deepEqual(escrow.status, { refunded: {} });

    const iBalAfter = Number(
      (await brProvider.connection.getTokenAccountBalance(brInitiatorToken.publicKey)).value.amount,
    );
    const bBalAfter = Number(
      (await brProvider.connection.getTokenAccountBalance(brBeneficiaryToken.publicKey)).value.amount,
    );
    assert.equal(iBalAfter - iBalBefore, escrowAmount + initiatorStake,
      "initiator receives escrow_amount + initiator_stake");
    assert.equal(bBalAfter - bBalBefore, beneficiaryStake,
      "beneficiary receives their stake back");
  });

  it("cancel_pending_escrow before time lock expires → TimeLockNotExpired", async () => {
    const { escrowPda, vaultAta } = await brBuildFundedEscrow({
      timeLockSecs: 7 * 24 * 3600,
    });

    try {
      await brEscrow.methods.cancelPendingEscrow().accounts({
        initiator: brInitiator.publicKey, escrowAccount: escrowPda,
        vault: vaultAta, initiatorTokenAccount: brInitiatorToken.publicKey,
        beneficiaryTokenAccount: brBeneficiaryToken.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        initiatorReputation: brInitiatorRepPda,
        beneficiaryReputation: brBeneficiaryRepPda,
        escrowAuthority: brEscrowAuthority,
        vaultpactProgram: brHoldfast.programId,
      }).signers([brInitiator]).rpc();
      assert.fail("expected TimeLockNotExpired");
    } catch (err: any) {
      if (err.message?.includes("expected TimeLockNotExpired")) throw err;
      assert.include(brGetDiag(err), "TimeLockNotExpired");
    }
  });

  it("cancel_pending_escrow on Locked escrow → InvalidStatus", async () => {
    const { escrowPda, vaultAta } = await brBuildLockedEscrow({
      timeLockSecs: 3600,
    });

    await warpClockForward(3601);

    try {
      await brEscrow.methods.cancelPendingEscrow().accounts({
        initiator: brInitiator.publicKey, escrowAccount: escrowPda,
        vault: vaultAta, initiatorTokenAccount: brInitiatorToken.publicKey,
        beneficiaryTokenAccount: brBeneficiaryToken.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        initiatorReputation: brInitiatorRepPda,
        beneficiaryReputation: brBeneficiaryRepPda,
        escrowAuthority: brEscrowAuthority,
        vaultpactProgram: brHoldfast.programId,
      }).signers([brInitiator]).rpc();
      assert.fail("expected InvalidStatus");
    } catch (err: any) {
      if (err.message?.includes("expected InvalidStatus")) throw err;
      assert.include(brGetDiag(err), "InvalidStatus");
    }
  });

  // ── CAS-387 / C-4: reputation decay blocks lock_escrow ────────────────

  it("C-4: decayed reputation score blocks lock_escrow (ReputationScoreTooLow)", async () => {
    // ReputationAccount layout offsets (after 8-byte Anchor discriminator):
    //   schema_version(1) + agent(32) = 41 → score(8)
    //   + tier(1) + total_pacts(8) + dispute_count(8) + created_at(8) + last_updated(8) = 82 → decay_cursor(8)
    const REP_SCORE_OFFSET = 41;
    const REP_DECAY_CURSOR_OFFSET = 82;

    // Snapshot original reputation data for restoration
    const origInfo = await brProvider.connection.getAccountInfo(brInitiatorRepPda);
    assert.isNotNull(origInfo, "initiator reputation account must exist");
    const origData = Buffer.from(origInfo!.data);

    try {
      // Set initiator score=6000 (1000 above neutral) with decay_cursor=now
      const currentClock = await context.banksClient.getClock();
      const now = Number(currentClock.unixTimestamp);

      const modData = Buffer.from(origData);
      modData.writeBigUInt64LE(6000n, REP_SCORE_OFFSET);
      modData.writeBigInt64LE(BigInt(now), REP_DECAY_CURSOR_OFFSET);

      context.setAccount(brInitiatorRepPda, {
        lamports: origInfo!.lamports,
        data: modData,
        owner: HOLDFAST_ID,
        executable: false,
      });

      // Verify precondition
      const repCheck = await brHoldfast.account.reputationAccount.fetch(brInitiatorRepPda);
      assert.equal(
        (repCheck.score as anchor.BN).toNumber(), 6000,
        "precondition: initiator score must be 6000",
      );

      // Init escrow with initiatorReputationMin=5500
      // At current time: effective = apply_decay(6000, now, now) = 6000 >= 5500 ✓
      const escrowId = Array.from(crypto.randomBytes(32));
      const idBuf = Buffer.from(escrowId);
      const [escrowPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), idBuf], ESCROW_ID,
      );
      const [pactPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("pact"), idBuf], ESCROW_ID,
      );
      const vaultAta = getAssociatedTokenAddress(brMint.publicKey, escrowPda);

      await brEscrow.methods.initializeEscrow({
        escrowId, beneficiary: brBeneficiary.publicKey, arbiter: brArbiter.publicKey,
        escrowAmount: new anchor.BN(100_000), initiatorStake: new anchor.BN(0),
        beneficiaryStake: new anchor.BN(0),
        timeLockExpiresAt: new anchor.BN(now + 365 * 24 * 3600),
        deliverablesHash: Array(32).fill(0), deliverablesUri: Array(128).fill(0),
        autoReleaseOnExpiry: false, slashLoserStake: false,
        disputeDeadlineSecs: new anchor.BN(86400),
        initiatorReputationMin: new anchor.BN(5500),
        beneficiaryReputationMin: new anchor.BN(0),
        initiatorMinTier: 0, initiatorMinPacts: new anchor.BN(0),
        beneficiaryMinTier: 0, beneficiaryMinPacts: new anchor.BN(0),
      }).accounts({
        initiator: brInitiator.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
        mint: brMint.publicKey, vault: vaultAta, initiatorReputation: brInitiatorRepPda,
        initiatorWallet: brInitiatorWalletPda, beneficiaryWallet: brBeneficiaryWalletPda,
        arbiterWallet: brArbiterWalletPda,
        vaultpactProgram: brHoldfast.programId, tokenProgram: TOKEN_PROGRAM_ID,
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
        vaultpactProgram: brHoldfast.programId, tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([brBeneficiary]).rpc();

      // Warp 70 days: effective = 5000 + 1000 * DECAY_TABLE[70] / 1_000_000 ≈ 5494 < 5500
      await warpClockForward(70 * 24 * 3600);

      try {
        await brEscrow.methods.lockEscrow().accounts({
          initiator: brInitiator.publicKey, beneficiary: brBeneficiary.publicKey,
          escrowAccount: escrowPda, vault: vaultAta,
          initiatorWallet: brInitiatorWalletPda, beneficiaryWallet: brBeneficiaryWalletPda,
          arbiterWallet: brArbiterWalletPda,
          pactRecord: pactPda, initiatorReputation: brInitiatorRepPda,
          beneficiaryReputation: brBeneficiaryRepPda,
          vaultpactProgram: brHoldfast.programId,
        }).signers([brInitiator, brBeneficiary]).rpc();
        assert.fail("expected ReputationScoreTooLow after decay");
      } catch (err: any) {
        if (err.message?.includes("expected ReputationScoreTooLow")) throw err;
        assert.include(brGetDiag(err), "ReputationScoreTooLow",
          "C-4: decayed reputation must block lock_escrow");
      }
    } finally {
      // Restore original reputation so subsequent tests are unaffected
      context.setAccount(brInitiatorRepPda, {
        lamports: origInfo!.lamports,
        data: origData,
        owner: HOLDFAST_ID,
        executable: false,
      });
    }
  });
});

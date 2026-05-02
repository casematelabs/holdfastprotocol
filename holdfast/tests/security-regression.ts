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

// ── Raw SPL Token instruction builders (same as main test file) ──────

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

// ── Security Regression Test Suite ───────────────────────────────────
// Finding IDs reference the internal security audit (CAS-8#security-audit-internal).
// Tests verify the vulnerable behavior EXISTS so that when fixes land (CAS-108),
// the assertions can be flipped to confirm the fix.

describe("Security Regression Tests (Internal Audit)", function () {
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
      vaultpactProgram.programId,
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

    const registerIx = await vaultpactProgram.methods
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

  // ── Shared state ───────────────────────────────────────────────────

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

    mintKeypair = await createSplMint(provider.wallet.publicKey);
    mintPubkey = mintKeypair.publicKey;

    initiatorTokenAccount = await createTokenAccount(
      mintPubkey,
      initiator.publicKey,
    );
    beneficiaryTokenAccount = await createTokenAccount(
      mintPubkey,
      beneficiary.publicKey,
    );

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

  // ── Helper: build locked escrow with custom params ─────────────────

  async function buildLockedEscrow(opts: {
    escrowAmount?: number;
    initiatorStake?: number;
    beneficiaryStake?: number;
    timeLockExpiresAt?: number;
    slashLoserStake?: boolean;
    disputeDeadlineSecs?: number;
    autoReleaseOnExpiry?: boolean;
    initiatorReputationMin?: number;
    beneficiaryReputationMin?: number;
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
      initiatorReputationMin: new anchor.BN(opts.initiatorReputationMin ?? 0),
      beneficiaryReputationMin: new anchor.BN(opts.beneficiaryReputationMin ?? 0),
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

  async function raiseDisputeOn(
    escrowPda: anchor.web3.PublicKey,
    pactPda: anchor.web3.PublicKey,
    disputePda: anchor.web3.PublicKey,
    raiser: anchor.web3.Keypair,
  ) {
    await escrowProgram.methods.raiseDispute({
      evidenceHash: Array(32).fill(0xaa),
      evidenceUri: Array(128).fill(0),
    }).accounts({
      raiser: raiser.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      disputeRecord: disputePda, systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([raiser]).rpc();
  }

  // ════════════════════════════════════════════════════════════════════
  // H-1: CPI helper now forwards pact tier/pacts requirements
  // ════════════════════════════════════════════════════════════════════
  // FIX VERIFIED: cpi_validate_reputation accepts min_tier and min_pacts
  // from the PactRecord and forwards them to validate_reputation_for_pact.

  it("H-1: Unverified agent with 0 pacts is rejected when pact requires Attested tier (CPI helper forwards tier/pacts)", async () => {
    const rep = await vaultpactProgram.account.reputationAccount.fetch(initiatorRepPda);
    assert.deepEqual(rep.tier, { unverified: {} }, "precondition: agent tier is Unverified");
    assert.equal(rep.totalPacts.toNumber(), 0, "precondition: agent has 0 completed pacts");

    const escrowId = generateEscrowId();
    const { escrowPda, pactPda } = deriveEscrowPdas(escrowId);
    const vaultAta = getAssociatedTokenAddress(mintPubkey, escrowPda);

    // FIX: initialize_escrow now rejects because initiator_min_tier=1 (Attested)
    // but the agent's tier is Unverified (0). The CPI helper correctly forwards
    // the tier requirement to validate_reputation_for_pact.
    try {
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
        initiatorMinTier: 1,
        initiatorMinPacts: new anchor.BN(5),
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
      assert.fail("expected ReputationTierTooLow");
    } catch (err: any) {
      if (err.message?.includes("expected ReputationTierTooLow")) throw err;
      const diag = getDiag(err);
      assert.include(diag, "ReputationTierTooLow",
        "H-1 FIX VERIFIED: CPI helper correctly enforces tier requirement");
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // H-2: Arbiter wallet validation now enforced
  // ════════════════════════════════════════════════════════════════════
  // FIX VERIFIED: initialize_escrow now requires an arbiter_wallet account
  // with constraint arbiter_wallet.authority == params.arbiter. An
  // unregistered pubkey is rejected at the account constraint level.

  it("H-2: Unregistered arbiter is rejected (arbiter_wallet authority mismatch)", async () => {
    const fakeArbiter = anchor.web3.Keypair.generate();

    const escrowId = generateEscrowId();
    const { escrowPda, pactPda } = deriveEscrowPdas(escrowId);
    const vaultAta = getAssociatedTokenAddress(mintPubkey, escrowPda);

    // FIX: passing arbiterWalletPda (which belongs to `arbiter`, not `fakeArbiter`)
    // triggers the constraint check: arbiter_wallet.authority != params.arbiter.
    try {
      await escrowProgram.methods.initializeEscrow({
        escrowId,
        beneficiary: beneficiary.publicKey,
        arbiter: fakeArbiter.publicKey,
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
        initiator: initiator.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
        mint: mintPubkey, vault: vaultAta, initiatorReputation: initiatorRepPda,
        initiatorWallet: initiatorWalletPda, beneficiaryWallet: beneficiaryWalletPda,
        arbiterWallet: arbiterWalletPda,
        vaultpactProgram: vaultpactProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      }).signers([initiator]).rpc();
      assert.fail("expected AgentWalletAuthorityMismatch");
    } catch (err: any) {
      if (err.message?.includes("expected AgentWalletAuthorityMismatch")) throw err;
      const diag = getDiag(err);
      assert.include(diag, "AgentWalletAuthorityMismatch",
        "H-2 FIX VERIFIED: unregistered arbiter rejected with authority mismatch");
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // M-2: Immediate dispute resolution (no governance delay)
  // ════════════════════════════════════════════════════════════════════
  // resolve_dispute has no minimum elapsed-time check since dispute
  // creation. An arbiter can raise and resolve in consecutive slots.

  it("M-2: Arbiter resolves dispute immediately after creation (no minimum delay)", async () => {
    const { escrowPda, pactPda, disputePda, vaultAta } = await buildLockedEscrow({
      escrowAmount: 100_000,
      initiatorStake: 10_000,
      beneficiaryStake: 10_000,
    });

    await raiseDisputeOn(escrowPda, pactPda, disputePda, beneficiary);

    const disputeBefore = await escrowProgram.account.disputeRecord.fetch(disputePda);
    const createdAt = disputeBefore.createdAt.toNumber();
    assert.ok(createdAt > 0, "dispute has valid created_at");

    // BUG: resolve_dispute succeeds immediately — no minimum governance delay.
    // Post-fix: require Clock::get().unix_timestamp >= dispute.created_at + MIN_DISPUTE_DELAY.
    await escrowProgram.methods.resolveDispute({
      decision: { releaseToBeneficiary: {} },
      reasoningHash: Array(32).fill(0xbb),
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
      vaultpactProgram: vaultpactProgram.programId,
    }).signers([arbiter]).rpc();

    const dispute = await escrowProgram.account.disputeRecord.fetch(disputePda);
    const resolvedAt = dispute.resolvedAt.toNumber();
    const elapsed = resolvedAt - createdAt;

    assert.ok(elapsed <= 2,
      `M-2 BUG CONFIRMED: dispute resolved ${elapsed}s after creation (no minimum delay enforced)`);
  });

  // ════════════════════════════════════════════════════════════════════
  // M-3: Dispute record orphaning on close
  // ════════════════════════════════════════════════════════════════════
  // close_escrow accepts dispute_record as Optional. When omitted after
  // a dispute was raised + resolved, the DisputeRecord PDA persists as
  // an orphaned account consuming rent indefinitely.

  it("M-3: close_escrow without dispute_record leaves orphaned DisputeRecord PDA", async () => {
    const { escrowPda, pactPda, disputePda, vaultAta } = await buildLockedEscrow({
      escrowAmount: 100_000,
      initiatorStake: 10_000,
      beneficiaryStake: 10_000,
    });

    await raiseDisputeOn(escrowPda, pactPda, disputePda, initiator);

    await escrowProgram.methods.resolveDispute({
      decision: { releaseToBeneficiary: {} },
      reasoningHash: Array(32).fill(0xcc),
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
      vaultpactProgram: vaultpactProgram.programId,
    }).signers([arbiter]).rpc();

    // Vault is empty after resolve — close escrow WITHOUT dispute_record
    // BUG: close_escrow succeeds without closing the dispute PDA.
    // Post-fix: require dispute_record when a dispute was raised, or
    // detect from escrow state and refuse close without it.
    await escrowProgram.methods.closeEscrow().accounts({
      initiator: initiator.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      disputeRecord: null,
      vault: vaultAta, tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([initiator]).rpc();

    // Escrow + pact PDAs are closed
    const escrowInfo = await provider.connection.getAccountInfo(escrowPda);
    assert.isNull(escrowInfo, "escrow PDA should be closed");

    // DisputeRecord is orphaned — still exists with no parent
    const disputeInfo = await provider.connection.getAccountInfo(disputePda);
    assert.isNotNull(disputeInfo,
      "M-3 BUG CONFIRMED: DisputeRecord PDA is orphaned after close_escrow (rent permanently locked)");
    assert.ok(disputeInfo!.data.length > 0, "orphaned dispute PDA still has data");
  });

  // ════════════════════════════════════════════════════════════════════
  // M-4: Invalid dispute_deadline_secs
  // ════════════════════════════════════════════════════════════════════
  // initialize_escrow does not validate dispute_deadline_secs.
  // A value of 0 means the arbiter's resolution deadline is the same
  // instant the dispute is raised, making escalation immediately possible.

  it("M-4: dispute_deadline_secs = 0 rejected (InvalidDisputeDeadline)", async () => {
    const escrowId = generateEscrowId();
    const { escrowPda, pactPda } = deriveEscrowPdas(escrowId);
    const vaultAta = getAssociatedTokenAddress(mintPubkey, escrowPda);

    try {
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
        disputeDeadlineSecs: new anchor.BN(0),
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
      assert.fail("Expected InvalidDisputeDeadline error for dispute_deadline_secs = 0");
    } catch (err: any) {
      assert.ok(err.error?.errorCode?.code === "InvalidDisputeDeadline" ||
        err.toString().includes("InvalidDisputeDeadline"),
        "M-4 FIX VERIFIED: dispute_deadline_secs = 0 rejected with InvalidDisputeDeadline");
    }
  });

  it("M-4: negative dispute_deadline_secs rejected (InvalidDisputeDeadline)", async () => {
    const escrowId = generateEscrowId();
    const { escrowPda, pactPda } = deriveEscrowPdas(escrowId);
    const vaultAta = getAssociatedTokenAddress(mintPubkey, escrowPda);

    try {
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
        disputeDeadlineSecs: new anchor.BN(-1),
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
      assert.fail("Expected InvalidDisputeDeadline error for negative dispute_deadline_secs");
    } catch (err: any) {
      assert.ok(err.error?.errorCode?.code === "InvalidDisputeDeadline" ||
        err.toString().includes("InvalidDisputeDeadline"),
        "M-4 FIX VERIFIED: negative dispute_deadline_secs rejected with InvalidDisputeDeadline");
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // Gap-7: beneficiary_token_account in claim_released must be
  // constrained on owner and mint (HIGH severity)
  // ════════════════════════════════════════════════════════════════════

  it("Gap-7: claim_released rejects beneficiary_token_account with wrong owner (UnauthorizedTokenAccount)", async () => {
    const { escrowPda, vaultAta } = await buildLockedEscrow({});

    const [escrowAuthority] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vp_escrow_authority")],
      escrowProgram.programId,
    );

    // Pass initiatorTokenAccount (owned by initiator, not beneficiary)
    try {
      await escrowProgram.methods.claimReleased().accounts({
        beneficiary: beneficiary.publicKey, escrowAccount: escrowPda,
        vault: vaultAta, beneficiaryTokenAccount: initiatorTokenAccount.publicKey,
        initiatorTokenAccount: initiatorTokenAccount.publicKey,
        beneficiaryWallet: beneficiaryWalletPda, tokenProgram: TOKEN_PROGRAM_ID,
        initiatorReputation: initiatorRepPda, beneficiaryReputation: beneficiaryRepPda,
        escrowAuthority, vaultpactProgram: vaultpactProgram.programId,
      }).signers([beneficiary]).rpc();
      assert.fail("Expected UnauthorizedTokenAccount for wrong owner");
    } catch (err: any) {
      if (err.message?.includes("Expected UnauthorizedTokenAccount")) throw err;
      const diag = getDiag(err);
      assert.include(diag, "UnauthorizedTokenAccount",
        "Gap-7 FIX VERIFIED: claim_released rejects beneficiary_token_account with wrong owner");
    }
  });

  it("Gap-7: claim_released rejects beneficiary_token_account with wrong mint (UnauthorizedTokenAccount)", async () => {
    const { escrowPda, vaultAta } = await buildLockedEscrow({});

    const [escrowAuthority] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vp_escrow_authority")],
      escrowProgram.programId,
    );

    // Create a second mint and a token account for beneficiary with wrong mint
    const wrongMint = await createSplMint(provider.wallet.publicKey);
    const wrongMintBeneficiaryAta = await createTokenAccount(
      wrongMint.publicKey, beneficiary.publicKey,
    );

    try {
      await escrowProgram.methods.claimReleased().accounts({
        beneficiary: beneficiary.publicKey, escrowAccount: escrowPda,
        vault: vaultAta, beneficiaryTokenAccount: wrongMintBeneficiaryAta.publicKey,
        initiatorTokenAccount: initiatorTokenAccount.publicKey,
        beneficiaryWallet: beneficiaryWalletPda, tokenProgram: TOKEN_PROGRAM_ID,
        initiatorReputation: initiatorRepPda, beneficiaryReputation: beneficiaryRepPda,
        escrowAuthority, vaultpactProgram: vaultpactProgram.programId,
      }).signers([beneficiary]).rpc();
      assert.fail("Expected UnauthorizedTokenAccount for wrong mint");
    } catch (err: any) {
      if (err.message?.includes("Expected UnauthorizedTokenAccount")) throw err;
      const diag = getDiag(err);
      assert.include(diag, "UnauthorizedTokenAccount",
        "Gap-7 FIX VERIFIED: claim_released rejects beneficiary_token_account with wrong mint");
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // C-1: close_escrow on Released status rejected with InvalidStatus (CAS-387)
  // ════════════════════════════════════════════════════════════════════
  // Verifies the fix: close_escrow now guards against non-terminal states.
  // Released is mid-lifecycle — vault still holds funds; closing it would
  // prevent the beneficiary from calling claimReleased.

  it("C-1: close_escrow on Released-status escrow rejects with InvalidStatus", async () => {
    const { escrowPda, pactPda, vaultAta } = await buildLockedEscrow({ escrowAmount: 50_000 });

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

    const escrow = await escrowProgram.account.escrowAccount.fetch(escrowPda);
    assert.deepEqual(escrow.status, { released: {} },
      "precondition: escrow must be Released before attempting close");

    try {
      await escrowProgram.methods
        .closeEscrow()
        .accounts({
          initiator: initiator.publicKey,
          escrowAccount: escrowPda,
          pactRecord: pactPda,
          disputeRecord: null,
          vault: vaultAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([initiator])
        .rpc();
      assert.fail("expected InvalidStatus for close_escrow on Released escrow");
    } catch (err: any) {
      if (err.message?.includes("expected InvalidStatus")) throw err;
      assert.include(getDiag(err), "InvalidStatus",
        "C-1 FIX VERIFIED: close_escrow on Released-status escrow rejects with InvalidStatus");
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // C-2: set_agent_status with non-PDA agent_wallet rejected (CAS-387)
  // ════════════════════════════════════════════════════════════════════
  // Verifies the Anchor seeds constraint on agent_wallet in set_agent_status.
  // A keypair-derived address (not PDA-derived from the expected seeds) is
  // rejected at account resolution before the instruction handler runs.

  it("C-2: set_agent_status with non-PDA agent_wallet rejected by Anchor constraint", async () => {
    const fakeWallet = anchor.web3.Keypair.generate();

    try {
      await vaultpactProgram.methods
        .setAgentStatus(0)
        .accounts({
          authority: provider.wallet.publicKey,
          agentWallet: fakeWallet.publicKey,
        })
        .rpc();
      assert.fail("expected Anchor account constraint rejection for non-PDA agent_wallet");
    } catch (err: any) {
      if (err.message?.includes("expected Anchor account constraint rejection")) throw err;
      const diag = getDiag(err);
      assert.ok(
        err.error?.errorCode?.number > 0 ||
        diag.includes("Error Code:") ||
        diag.includes("AccountNotInitialized") ||
        diag.includes("ConstraintSeeds") ||
        diag.includes("custom program error"),
        `C-2 FIX VERIFIED: non-PDA agent_wallet rejected by Anchor — got: ${diag}`,
      );
    }
  });
});

// ════════════════════════════════════════════════════════════════════════
// C-1: Beneficiary reputation bypass at lock (bankrun — needs account
// manipulation to lower reputation between stake and lock)
// ════════════════════════════════════════════════════════════════════════

(bankrunMod ? describe : describe.skip)("bankrun: C-1 Beneficiary reputation bypass at lock", function () {
  this.timeout(120_000);

  const VAULTPACT_ID = new anchor.web3.PublicKey("2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq");
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
  let brRegistryPda: anchor.web3.PublicKey;
  let bRepBump: number;

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

  async function encodeReputation(
    agent: anchor.web3.PublicKey,
    bump: number,
    score = 5_000,
  ): Promise<Buffer> {
    return await brVaultpact.coder.accounts.encode("ReputationAccount", {
      agent,
      score: new anchor.BN(score),
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
    return await brVaultpact.coder.accounts.encode("AttestationRegistry", {
      authority: auth,
      agentCount: new anchor.BN(2),
      bump,
    });
  }

  function makeTokenAccountData(
    mint: anchor.web3.PublicKey,
    owner: anchor.web3.PublicKey,
    amount: bigint,
  ): Buffer {
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

    // Pre-populate ReputationAccount PDAs (score = 5000, meets min)
    const [iRepPda, iRepBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("reputation"), brInitiator.publicKey.toBuffer()], VAULTPACT_ID,
    );
    brInitiatorRepPda = iRepPda;
    setPrebuiltAccount(iRepPda, VAULTPACT_ID, await encodeReputation(brInitiator.publicKey, iRepBump));

    const [bRepPdaAddr, bRepBumpVal] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("reputation"), brBeneficiary.publicKey.toBuffer()], VAULTPACT_ID,
    );
    brBeneficiaryRepPda = bRepPdaAddr;
    bRepBump = bRepBumpVal;
    setPrebuiltAccount(bRepPdaAddr, VAULTPACT_ID, await encodeReputation(brBeneficiary.publicKey, bRepBumpVal));

    // Pre-populate AttestationRegistry
    const [regPda, regBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("attestation_registry")], VAULTPACT_ID,
    );
    brRegistryPda = regPda;
    setPrebuiltAccount(regPda, VAULTPACT_ID, await encodeRegistry(authority.publicKey, regBump));

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

    setPrebuiltAccount(brInitiatorToken.publicKey, TOKEN_PROGRAM_ID,
      makeTokenAccountData(brMint.publicKey, brInitiator.publicKey, 10_000_000n), 1_000_000_000);
    setPrebuiltAccount(brBeneficiaryToken.publicKey, TOKEN_PROGRAM_ID,
      makeTokenAccountData(brMint.publicKey, brBeneficiary.publicKey, 10_000_000n), 1_000_000_000);
  });

  it("C-1: lock_escrow rejects when beneficiary reputation drops below pact minimum", async () => {
    const escrowId = Array.from(crypto.randomBytes(32));
    const idBuffer = Buffer.from(escrowId);
    const [escrowPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), idBuffer], ESCROW_ID,
    );
    const [pactPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pact"), idBuffer], ESCROW_ID,
    );
    const vaultAta = getAssociatedTokenAddress(brMint.publicKey, escrowPda);

    // Step 1: Init escrow with beneficiary_reputation_min = 5000
    await brEscrow.methods.initializeEscrow({
      escrowId,
      beneficiary: brBeneficiary.publicKey,
      arbiter: brArbiter.publicKey,
      escrowAmount: new anchor.BN(100_000),
      initiatorStake: new anchor.BN(10_000),
      beneficiaryStake: new anchor.BN(10_000),
      timeLockExpiresAt: new anchor.BN(Math.floor(Date.now() / 1000) + 3600),
      deliverablesHash: Array(32).fill(0),
      deliverablesUri: Array(128).fill(0),
      autoReleaseOnExpiry: false,
      slashLoserStake: false,
      disputeDeadlineSecs: new anchor.BN(86400),
      initiatorReputationMin: new anchor.BN(0),
      beneficiaryReputationMin: new anchor.BN(5000),
      initiatorMinTier: 0,
      initiatorMinPacts: new anchor.BN(0),
      beneficiaryMinTier: 0,
      beneficiaryMinPacts: new anchor.BN(0),
    }).accounts({
      initiator: brInitiator.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      mint: brMint.publicKey, vault: vaultAta, initiatorReputation: brInitiatorRepPda,
      initiatorWallet: brInitiatorWalletPda, beneficiaryWallet: brBeneficiaryWalletPda,
      arbiterWallet: brArbiterWalletPda,
      vaultpactProgram: brVaultpact.programId, tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([brInitiator]).rpc();

    // Step 2: Deposit
    await brEscrow.methods.depositFunds().accounts({
      initiator: brInitiator.publicKey, escrowAccount: escrowPda,
      initiatorTokenAccount: brInitiatorToken.publicKey,
      vault: vaultAta, tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([brInitiator]).rpc();

    // Step 3: Stake beneficiary (reputation = 5000, meets min of 5000)
    await brEscrow.methods.stakeBeneficiary().accounts({
      beneficiary: brBeneficiary.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      beneficiaryTokenAccount: brBeneficiaryToken.publicKey,
      vault: vaultAta, beneficiaryReputation: brBeneficiaryRepPda,
      beneficiaryWallet: brBeneficiaryWalletPda,
      vaultpactProgram: brVaultpact.programId, tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([brBeneficiary]).rpc();

    // Step 4: BETWEEN STAKE AND LOCK — lower beneficiary reputation to 1000
    setPrebuiltAccount(
      brBeneficiaryRepPda,
      VAULTPACT_ID,
      await encodeReputation(brBeneficiary.publicKey, bRepBump, 1000),
    );

    const rep = await brVaultpact.account.reputationAccount.fetch(brBeneficiaryRepPda);
    assert.equal(rep.score.toNumber(), 1000,
      "precondition: beneficiary reputation lowered to 1000 (below pact min of 5000)");

    // Step 5: FIX — lock_escrow now rejects because beneficiary rep (1000) is
    // below the pact's beneficiary_reputation_min (5000). lock_escrow re-validates
    // reputation via CPI before allowing the lock.
    try {
      await brEscrow.methods.lockEscrow().accounts({
        initiator: brInitiator.publicKey, beneficiary: brBeneficiary.publicKey,
        escrowAccount: escrowPda, pactRecord: pactPda, vault: vaultAta,
        initiatorWallet: brInitiatorWalletPda, beneficiaryWallet: brBeneficiaryWalletPda,
        arbiterWallet: brArbiterWalletPda,
        initiatorReputation: brInitiatorRepPda,
        beneficiaryReputation: brBeneficiaryRepPda,
        vaultpactProgram: brVaultpact.programId,
      }).signers([brInitiator, brBeneficiary]).rpc();
      assert.fail("expected ReputationScoreTooLow");
    } catch (err: any) {
      if (err.message?.includes("expected ReputationScoreTooLow")) throw err;
      const logs = (err.logs as string[] | undefined)?.join(" ") ?? err.message ?? "";
      assert.include(logs, "ReputationScoreTooLow",
        "C-1 FIX VERIFIED: lock_escrow rejects when beneficiary reputation drops below pact minimum");
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // Gap-8: Re-escalation deadline reset (bankrun — needs time warp
  // to get past resolution_deadline and escalate twice)
  // ════════════════════════════════════════════════════════════════════

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

  it("Gap-8: second escalate_dispute call fails with DisputeAlreadyEscalated", async () => {
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

    // Reset beneficiary reputation to 5000 (may have been lowered by C-1 test)
    setPrebuiltAccount(
      brBeneficiaryRepPda,
      VAULTPACT_ID,
      await encodeReputation(brBeneficiary.publicKey, bRepBump, 5000),
    );

    // Build locked escrow with short dispute deadline (1 hour)
    await brEscrow.methods.initializeEscrow({
      escrowId,
      beneficiary: brBeneficiary.publicKey,
      arbiter: brArbiter.publicKey,
      escrowAmount: new anchor.BN(100_000),
      initiatorStake: new anchor.BN(0),
      beneficiaryStake: new anchor.BN(0),
      timeLockExpiresAt: new anchor.BN(Math.floor(Date.now() / 1000) + 7200),
      deliverablesHash: Array(32).fill(0),
      deliverablesUri: Array(128).fill(0),
      autoReleaseOnExpiry: false,
      slashLoserStake: false,
      disputeDeadlineSecs: new anchor.BN(3600),
      initiatorReputationMin: new anchor.BN(0),
      beneficiaryReputationMin: new anchor.BN(0),
      initiatorMinTier: 0,
      initiatorMinPacts: new anchor.BN(0),
      beneficiaryMinTier: 0,
      beneficiaryMinPacts: new anchor.BN(0),
    }).accounts({
      initiator: brInitiator.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      mint: brMint.publicKey, vault: vaultAta, initiatorReputation: brInitiatorRepPda,
      initiatorWallet: brInitiatorWalletPda, beneficiaryWallet: brBeneficiaryWalletPda,
      arbiterWallet: brArbiterWalletPda,
      vaultpactProgram: brVaultpact.programId, tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([brInitiator]).rpc();

    // Deposit + stake + lock
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
      escrowAccount: escrowPda, pactRecord: pactPda, vault: vaultAta,
      initiatorWallet: brInitiatorWalletPda, beneficiaryWallet: brBeneficiaryWalletPda,
      arbiterWallet: brArbiterWalletPda,
      initiatorReputation: brInitiatorRepPda,
      beneficiaryReputation: brBeneficiaryRepPda,
      vaultpactProgram: brVaultpact.programId,
    }).signers([brInitiator, brBeneficiary]).rpc();

    // Raise dispute
    await brEscrow.methods.raiseDispute({
      evidenceHash: Array(32).fill(0xbb),
      evidenceUri: Array(128).fill(0),
    }).accounts({
      raiser: brInitiator.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      disputeRecord: disputePda, systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([brInitiator]).rpc();

    // Warp past resolution deadline (dispute_deadline_secs = 3600)
    await warpClockForward(3601);

    // First escalation should succeed
    await brEscrow.methods.escalateDispute().accounts({
      escalator: brInitiator.publicKey, escrowAccount: escrowPda,
      disputeRecord: disputePda,
    }).signers([brInitiator]).rpc();

    const dispute = await brEscrow.account.disputeRecord.fetch(disputePda);
    assert.ok(dispute.escalatedAt.toNumber() > 0, "precondition: dispute.escalated_at is set");

    // Second escalation should fail with DisputeAlreadyEscalated
    try {
      await brEscrow.methods.escalateDispute().accounts({
        escalator: brInitiator.publicKey, escrowAccount: escrowPda,
        disputeRecord: disputePda,
      }).signers([brInitiator]).rpc();
      assert.fail("Expected DisputeAlreadyEscalated on second escalation");
    } catch (err: any) {
      if (err.message?.includes("Expected DisputeAlreadyEscalated")) throw err;
      const logs = (err.logs as string[] | undefined)?.join(" ") ?? err.message ?? "";
      assert.include(logs, "DisputeAlreadyEscalated",
        "Gap-8 FIX VERIFIED: re-escalation rejected with DisputeAlreadyEscalated");
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // Gap-9: Minimum stake enforcement (CAS-177)
  // ════════════════════════════════════════════════════════════════════

  it("Gap-9a: slash_loser_stake=true with zero initiator_stake is rejected", async () => {
    const escrowId = generateEscrowId();
    const { escrowPda, pactPda } = deriveEscrowPdas(escrowId);
    const vaultAta = getAssociatedTokenAddress(mintPubkey, escrowPda);

    try {
      await escrowProgram.methods.initializeEscrow({
        escrowId,
        beneficiary: beneficiary.publicKey,
        arbiter: arbiter.publicKey,
        escrowAmount: new anchor.BN(100_000),
        initiatorStake: new anchor.BN(0),
        beneficiaryStake: new anchor.BN(10_000),
        timeLockExpiresAt: new anchor.BN(Math.floor(Date.now() / 1000) + 3600),
        deliverablesHash: Array(32).fill(0),
        deliverablesUri: Array(128).fill(0),
        autoReleaseOnExpiry: false,
        slashLoserStake: true,
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
      assert.fail("Expected SlashRequiresStake");
    } catch (err: any) {
      if (err.message?.includes("Expected SlashRequiresStake")) throw err;
      const diag = getDiag(err);
      assert.include(diag, "SlashRequiresStake",
        "Gap-9 FIX VERIFIED: slash_loser_stake=true with zero initiator stake rejected");
    }
  });

  it("Gap-9b: slash_loser_stake=true with zero beneficiary_stake is rejected", async () => {
    const escrowId = generateEscrowId();
    const { escrowPda, pactPda } = deriveEscrowPdas(escrowId);
    const vaultAta = getAssociatedTokenAddress(mintPubkey, escrowPda);

    try {
      await escrowProgram.methods.initializeEscrow({
        escrowId,
        beneficiary: beneficiary.publicKey,
        arbiter: arbiter.publicKey,
        escrowAmount: new anchor.BN(100_000),
        initiatorStake: new anchor.BN(10_000),
        beneficiaryStake: new anchor.BN(0),
        timeLockExpiresAt: new anchor.BN(Math.floor(Date.now() / 1000) + 3600),
        deliverablesHash: Array(32).fill(0),
        deliverablesUri: Array(128).fill(0),
        autoReleaseOnExpiry: false,
        slashLoserStake: true,
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
      assert.fail("Expected SlashRequiresStake");
    } catch (err: any) {
      if (err.message?.includes("Expected SlashRequiresStake")) throw err;
      const diag = getDiag(err);
      assert.include(diag, "SlashRequiresStake",
        "Gap-9 FIX VERIFIED: slash_loser_stake=true with zero beneficiary stake rejected");
    }
  });

  it("Gap-9c: dust stake below MINIMUM_STAKE (1000) is rejected", async () => {
    const escrowId = generateEscrowId();
    const { escrowPda, pactPda } = deriveEscrowPdas(escrowId);
    const vaultAta = getAssociatedTokenAddress(mintPubkey, escrowPda);

    try {
      await escrowProgram.methods.initializeEscrow({
        escrowId,
        beneficiary: beneficiary.publicKey,
        arbiter: arbiter.publicKey,
        escrowAmount: new anchor.BN(100_000),
        initiatorStake: new anchor.BN(500),
        beneficiaryStake: new anchor.BN(500),
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
      assert.fail("Expected StakeBelowMinimum");
    } catch (err: any) {
      if (err.message?.includes("Expected StakeBelowMinimum")) throw err;
      const diag = getDiag(err);
      assert.include(diag, "StakeBelowMinimum",
        "Gap-9 FIX VERIFIED: dust stakes below 1000 base units rejected");
    }
  });

  it("Gap-9d: zero-stake without slashing is allowed (design choice)", async () => {
    const escrowId = generateEscrowId();
    const { escrowPda, pactPda } = deriveEscrowPdas(escrowId);
    const vaultAta = getAssociatedTokenAddress(mintPubkey, escrowPda);

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
      initiator: initiator.publicKey, escrowAccount: escrowPda, pactRecord: pactPda,
      mint: mintPubkey, vault: vaultAta, initiatorReputation: initiatorRepPda,
      initiatorWallet: initiatorWalletPda, beneficiaryWallet: beneficiaryWalletPda,
      arbiterWallet: arbiterWalletPda,
      vaultpactProgram: vaultpactProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([initiator]).rpc();

    const escrow = await escrowProgram.account.escrowAccount.fetch(escrowPda);
    assert.equal(escrow.initiatorStake.toNumber(), 0);
    assert.equal(escrow.beneficiaryStake.toNumber(), 0);
  });

  it("Gap-9e: valid stakes at minimum threshold with slashing succeed", async () => {
    const escrowId = generateEscrowId();
    const { escrowPda, pactPda } = deriveEscrowPdas(escrowId);
    const vaultAta = getAssociatedTokenAddress(mintPubkey, escrowPda);

    await escrowProgram.methods.initializeEscrow({
      escrowId,
      beneficiary: beneficiary.publicKey,
      arbiter: arbiter.publicKey,
      escrowAmount: new anchor.BN(100_000),
      initiatorStake: new anchor.BN(1_000),
      beneficiaryStake: new anchor.BN(1_000),
      timeLockExpiresAt: new anchor.BN(Math.floor(Date.now() / 1000) + 3600),
      deliverablesHash: Array(32).fill(0),
      deliverablesUri: Array(128).fill(0),
      autoReleaseOnExpiry: false,
      slashLoserStake: true,
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

    const escrow = await escrowProgram.account.escrowAccount.fetch(escrowPda);
    assert.equal(escrow.initiatorStake.toNumber(), 1_000);
    assert.equal(escrow.beneficiaryStake.toNumber(), 1_000);
  });

  // ════════════════════════════════════════════════════════════════════
  // C-4: lock_escrow rejects when time-decayed reputation drops below
  // pact minimum — bankrun clock warp (CAS-387)
  // ════════════════════════════════════════════════════════════════════
  // Verifies the fix: validate_reputation_for_pact now applies lazy decay
  // based on (clock.unix_timestamp − decay_cursor) before comparing against
  // beneficiary_reputation_min. Warping 200 days reduces score=6000 well
  // below threshold=5000, triggering ReputationScoreTooLow at lock_escrow.

  it("C-4: lock_escrow rejects when decayed reputation drops below pact minimum (clock warp)", async () => {
    const escrowId = Array.from(crypto.randomBytes(32));
    const idBuffer = Buffer.from(escrowId);
    const [escrowPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), idBuffer], ESCROW_ID,
    );
    const [pactPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("pact"), idBuffer], ESCROW_ID,
    );
    const vaultAta = getAssociatedTokenAddress(brMint.publicKey, escrowPda);

    // Reset beneficiary reputation to score=6000 (above threshold 5000).
    // encodeReputation sets decay_cursor = Date.now()/1000; after warpClockForward
    // the effective decay period ≈ 200 days, dropping score well below 5000.
    setPrebuiltAccount(
      brBeneficiaryRepPda,
      VAULTPACT_ID,
      await encodeReputation(brBeneficiary.publicKey, bRepBump, 6000),
    );
    const repBefore = await brVaultpact.account.reputationAccount.fetch(brBeneficiaryRepPda);
    assert.equal(repBefore.score.toNumber(), 6000,
      "precondition: beneficiary score must be 6000 before clock warp");

    const currentClock = await context.banksClient.getClock();
    const timeLock = Number(currentClock.unixTimestamp) + 365 * 24 * 3600;

    // Build escrow through to Staked — score=6000 satisfies min=5000 at init/stake time
    await brEscrow.methods.initializeEscrow({
      escrowId,
      beneficiary: brBeneficiary.publicKey,
      arbiter: brArbiter.publicKey,
      escrowAmount: new anchor.BN(100_000),
      initiatorStake: new anchor.BN(0),
      beneficiaryStake: new anchor.BN(0),
      timeLockExpiresAt: new anchor.BN(timeLock),
      deliverablesHash: Array(32).fill(0),
      deliverablesUri: Array(128).fill(0),
      autoReleaseOnExpiry: false,
      slashLoserStake: false,
      disputeDeadlineSecs: new anchor.BN(86400),
      initiatorReputationMin: new anchor.BN(0),
      beneficiaryReputationMin: new anchor.BN(5000),
      initiatorMinTier: 0,
      initiatorMinPacts: new anchor.BN(0),
      beneficiaryMinTier: 0,
      beneficiaryMinPacts: new anchor.BN(0),
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

    // Warp clock 200 days — effective decay from decay_cursor to warped clock ≈ 200 days.
    // At 12 pts/day decay rate (per threat model), score drops ~2400 pts → ~3600 < 5000.
    await warpClockForward(200 * 24 * 3600);

    // lock_escrow re-validates beneficiary reputation via CPI; decayed score < 5000
    try {
      await brEscrow.methods.lockEscrow().accounts({
        initiator: brInitiator.publicKey, beneficiary: brBeneficiary.publicKey,
        escrowAccount: escrowPda, pactRecord: pactPda, vault: vaultAta,
        initiatorWallet: brInitiatorWalletPda, beneficiaryWallet: brBeneficiaryWalletPda,
        arbiterWallet: brArbiterWalletPda,
        initiatorReputation: brInitiatorRepPda,
        beneficiaryReputation: brBeneficiaryRepPda,
        vaultpactProgram: brVaultpact.programId,
      }).signers([brInitiator, brBeneficiary]).rpc();
      assert.fail("expected ReputationScoreTooLow due to time-based decay");
    } catch (err: any) {
      if (err.message?.includes("expected ReputationScoreTooLow")) throw err;
      const logs = (err.logs as string[] | undefined)?.join(" ") ?? err.message ?? "";
      assert.include(logs, "ReputationScoreTooLow",
        "C-4 FIX VERIFIED: lock_escrow rejects when decayed reputation drops below pact minimum");
    }
  });
});

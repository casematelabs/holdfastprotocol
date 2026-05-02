// =====================================================================
//
//  dispute-deadline.ts — Regression tests for dispute_deadline_secs
//  boundary validation (CAS-158)
//
//  Suite 1 — initialize_escrow rejects invalid dispute_deadline_secs
//    - Zero, negative, below-minimum (3599), i64::MIN-equivalent values
//    - Exactly-at-minimum (3600) and large (365 days) values accepted
//
//  Suite 2 — escalate_dispute timing boundary (bankrun)
//    - One second before resolution_deadline → ResolutionDeadlineNotPassed
//    - Exactly at resolution_deadline → ResolutionDeadlineNotPassed
//    - One second after resolution_deadline → success
//
// =====================================================================

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { VaultpactEscrow } from "../target/types/vaultpact_escrow";
import { Vaultpact } from "../target/types/vaultpact";
import { assert } from "chai";
import * as crypto from "crypto";

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

// ── Raw SPL Token instruction builders ──────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────
//  Suite 1 — initialize_escrow: dispute_deadline_secs boundary validation
// ─────────────────────────────────────────────────────────────────────────

describe("CAS-158: dispute_deadline_secs boundary validation (initialize_escrow)", function () {
  this.timeout(1_000_000);

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const escrowProgram = anchor.workspace.VaultpactEscrow as Program<VaultpactEscrow>;
  const vaultpactProgram = anchor.workspace.Vaultpact as Program<Vaultpact>;

  const [registryPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("attestation_registry")],
    vaultpactProgram.programId,
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
      await provider.connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE);
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
  ): Promise<{ walletPda: anchor.web3.PublicKey }> {
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

    return { walletPda };
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
    return { escrowPda, pactPda };
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
  let mintPubkey: anchor.web3.PublicKey;
  let initiatorWalletPda: anchor.web3.PublicKey;
  let beneficiaryWalletPda: anchor.web3.PublicKey;
  let arbiterWalletPda: anchor.web3.PublicKey;
  let initiatorRepPda: anchor.web3.PublicKey;

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

    initiatorRepPda = await initReputation(initiator);

    const mintKeypair = await createSplMint(provider.wallet.publicKey);
    mintPubkey = mintKeypair.publicKey;

    const walletKeypair = anchor.web3.Keypair.fromSecretKey(
      (provider.wallet as anchor.Wallet).payer.secretKey,
    );
    const initiatorTokenAccount = await createTokenAccount(mintPubkey, initiator.publicKey);
    await mintTokens(mintPubkey, initiatorTokenAccount.publicKey, walletKeypair, 10_000_000);
  });

  async function tryInitializeEscrow(disputeDeadlineSecs: anchor.BN): Promise<void> {
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
      timeLockExpiresAt: new anchor.BN(Math.floor(Date.now() / 1000) + 7200),
      deliverablesHash: Array(32).fill(0),
      deliverablesUri: Array(128).fill(0),
      autoReleaseOnExpiry: false,
      slashLoserStake: false,
      disputeDeadlineSecs,
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
      mint: mintPubkey,
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
  }

  // ── Test: Zero deadline ─────────────────────────────────────────────

  it("rejects dispute_deadline_secs = 0 (InvalidDisputeDeadline)", async () => {
    try {
      await tryInitializeEscrow(new anchor.BN(0));
      assert.fail("Expected InvalidDisputeDeadline for dispute_deadline_secs = 0");
    } catch (err: any) {
      if (err.message?.includes("Expected InvalidDisputeDeadline")) throw err;
      const diag = getDiag(err);
      assert.include(diag, "InvalidDisputeDeadline",
        "dispute_deadline_secs = 0 must be rejected");
    }
  });

  // ── Test: Negative deadline ─────────────────────────────────────────

  it("rejects dispute_deadline_secs = -1 (InvalidDisputeDeadline)", async () => {
    try {
      await tryInitializeEscrow(new anchor.BN(-1));
      assert.fail("Expected InvalidDisputeDeadline for dispute_deadline_secs = -1");
    } catch (err: any) {
      if (err.message?.includes("Expected InvalidDisputeDeadline")) throw err;
      const diag = getDiag(err);
      assert.include(diag, "InvalidDisputeDeadline",
        "dispute_deadline_secs = -1 must be rejected");
    }
  });

  // ── Test: Large negative (i64::MIN equivalent) ──────────────────────

  it("rejects dispute_deadline_secs = i64::MIN (InvalidDisputeDeadline)", async () => {
    try {
      await tryInitializeEscrow(new anchor.BN("-9223372036854775808"));
      assert.fail("Expected InvalidDisputeDeadline for i64::MIN");
    } catch (err: any) {
      if (err.message?.includes("Expected InvalidDisputeDeadline")) throw err;
      const diag = getDiag(err);
      assert.include(diag, "InvalidDisputeDeadline",
        "dispute_deadline_secs = i64::MIN must be rejected");
    }
  });

  // ── Test: One below minimum (3599) ──────────────────────────────────

  it("rejects dispute_deadline_secs = 3599 (one below minimum)", async () => {
    try {
      await tryInitializeEscrow(new anchor.BN(3599));
      assert.fail("Expected InvalidDisputeDeadline for dispute_deadline_secs = 3599");
    } catch (err: any) {
      if (err.message?.includes("Expected InvalidDisputeDeadline")) throw err;
      const diag = getDiag(err);
      assert.include(diag, "InvalidDisputeDeadline",
        "dispute_deadline_secs = 3599 (one below 3600 minimum) must be rejected");
    }
  });

  // ── Test: Exactly at minimum (3600) ─────────────────────────────────

  it("accepts dispute_deadline_secs = 3600 (exactly at minimum)", async () => {
    await tryInitializeEscrow(new anchor.BN(3600));
  });

  // ── Test: Large value (365 days = 31,536,000 seconds) ───────────────

  it("accepts dispute_deadline_secs = 31536000 (365 days — no upper bound)", async () => {
    await tryInitializeEscrow(new anchor.BN(31_536_000));
  });
});

// ─────────────────────────────────────────────────────────────────────────
//  Suite 2 — escalate_dispute timing boundary (bankrun)
//
//  Uses bankrun to warp the clock to exact second-level boundaries around
//  the resolution_deadline, testing the strict `now > resolution_deadline`
//  check in escalate_dispute.
// ─────────────────────────────────────────────────────────────────────────

(bankrunMod ? describe : describe.skip)(
  "CAS-158: escalate_dispute resolution_deadline boundary (bankrun)",
  function () {
    this.timeout(120_000);

    const VAULTPACT_ID = new anchor.web3.PublicKey("2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq");
    const ESCROW_ID = new anchor.web3.PublicKey("CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi");

    let context: any;
    let brProvider: any;
    let brEscrow: Program<VaultpactEscrow>;
    let brVaultpact: Program<Vaultpact>;
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

    async function setClockTo(timestamp: bigint) {
      const currentClock = await context.banksClient.getClock();
      context.setClock(new bankrunMod.Clock(
        currentClock.slot,
        currentClock.epochStartTimestamp,
        currentClock.epoch,
        currentClock.leaderScheduleEpoch,
        timestamp,
      ));
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

    // Shared escrow state for boundary tests
    let escrowPda: anchor.web3.PublicKey;
    let pactPda: anchor.web3.PublicKey;
    let disputePda: anchor.web3.PublicKey;
    let resolutionDeadline: bigint;

    before(async () => {
      const authority = anchor.web3.Keypair.generate();

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
      const iPubkeyX = Buffer.alloc(32, 0x21);
      const iPubkeyY = Buffer.alloc(32, 0x22);
      const [iWalletPda, iWalletBump] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("agent_wallet"), iPubkeyX, iPubkeyY], VAULTPACT_ID,
      );
      brInitiatorWalletPda = iWalletPda;

      const bPubkeyX = Buffer.alloc(32, 0x23);
      const bPubkeyY = Buffer.alloc(32, 0x24);
      const [bWalletPda, bWalletBump] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("agent_wallet"), bPubkeyX, bPubkeyY], VAULTPACT_ID,
      );
      brBeneficiaryWalletPda = bWalletPda;

      const aPubkeyX = Buffer.alloc(32, 0x25);
      const aPubkeyY = Buffer.alloc(32, 0x26);
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

      // Initialise ReputationAccount PDAs via on-chain tx so schema_version is set correctly.
      // (IDL-coder pre-population omits schema_version; use initReputation instead.)
      const [iRepPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("reputation"), brInitiator.publicKey.toBuffer()], VAULTPACT_ID,
      );
      brInitiatorRepPda = iRepPda;
      await brVaultpact.methods.initReputation()
        .accounts({ reputationAccount: iRepPda, agent: brInitiator.publicKey, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([brInitiator])
        .rpc();

      const [bRepPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("reputation"), brBeneficiary.publicKey.toBuffer()], VAULTPACT_ID,
      );
      brBeneficiaryRepPda = bRepPda;
      await brVaultpact.methods.initReputation()
        .accounts({ reputationAccount: bRepPda, agent: brBeneficiary.publicKey, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([brBeneficiary])
        .rpc();

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

      // Build locked escrow with dispute_deadline_secs = 3600 (1 hour)
      const DISPUTE_DEADLINE_SECS = 3600;
      const escrowId = Array.from(crypto.randomBytes(32));
      const idBuffer = Buffer.from(escrowId);
      [escrowPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("escrow"), idBuffer], ESCROW_ID,
      );
      [pactPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("pact"), idBuffer], ESCROW_ID,
      );
      [disputePda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("dispute"), idBuffer], ESCROW_ID,
      );
      const vaultAta = getAssociatedTokenAddress(brMint.publicKey, escrowPda);

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
        disputeDeadlineSecs: new anchor.BN(DISPUTE_DEADLINE_SECS),
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
        mint: brMint.publicKey,
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

      // Deposit funds
      await brEscrow.methods.depositFunds().accounts({
        initiator: brInitiator.publicKey,
        escrowAccount: escrowPda,
        initiatorTokenAccount: brInitiatorToken.publicKey,
        vault: vaultAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([brInitiator]).rpc();

      // Stake beneficiary
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

      // Lock
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

      // Raise dispute
      await brEscrow.methods.raiseDispute({
        evidenceHash: Array(32).fill(0xdd),
        evidenceUri: Array(128).fill(0),
      }).accounts({
        raiser: brInitiator.publicKey,
        escrowAccount: escrowPda,
        pactRecord: pactPda,
        disputeRecord: disputePda,
        systemProgram: anchor.web3.SystemProgram.programId,
      }).signers([brInitiator]).rpc();

      // Read the actual resolution_deadline from the dispute record
      const dispute = await brEscrow.account.disputeRecord.fetch(disputePda);
      resolutionDeadline = BigInt(dispute.resolutionDeadline.toString());
    });

    it("escalate_dispute fails one second BEFORE resolution_deadline (ResolutionDeadlineNotPassed)", async () => {
      await setClockTo(resolutionDeadline - 1n);

      try {
        await brEscrow.methods.escalateDispute().accounts({
          escalator: brInitiator.publicKey,
          escrowAccount: escrowPda,
          disputeRecord: disputePda,
        }).signers([brInitiator]).rpc();
        assert.fail("Expected ResolutionDeadlineNotPassed");
      } catch (err: any) {
        if (err.message?.includes("Expected ResolutionDeadlineNotPassed")) throw err;
        const logs = (err.logs as string[] | undefined)?.join(" ") ?? err.message ?? "";
        assert.include(logs, "ResolutionDeadlineNotPassed",
          "escalation one second before deadline must fail");
      }
    });

    it("escalate_dispute fails EXACTLY AT resolution_deadline (strict > check)", async () => {
      await setClockTo(resolutionDeadline);

      try {
        await brEscrow.methods.escalateDispute().accounts({
          escalator: brInitiator.publicKey,
          escrowAccount: escrowPda,
          disputeRecord: disputePda,
        }).signers([brInitiator]).rpc();
        assert.fail("Expected ResolutionDeadlineNotPassed");
      } catch (err: any) {
        if (err.message?.includes("Expected ResolutionDeadlineNotPassed")) throw err;
        const logs = (err.logs as string[] | undefined)?.join(" ") ?? err.message ?? "";
        assert.include(logs, "ResolutionDeadlineNotPassed",
          "escalation exactly at deadline must fail (check is strictly greater-than)");
      }
    });

    it("escalate_dispute succeeds one second AFTER resolution_deadline", async () => {
      await setClockTo(resolutionDeadline + 1n);

      await brEscrow.methods.escalateDispute().accounts({
        escalator: brInitiator.publicKey,
        escrowAccount: escrowPda,
        disputeRecord: disputePda,
      }).signers([brInitiator]).rpc();

      const dispute = await brEscrow.account.disputeRecord.fetch(disputePda);
      assert.ok(dispute.escalatedAt.toNumber() > 0,
        "dispute must be escalated (escalated_at > 0)");
    });
  },
);

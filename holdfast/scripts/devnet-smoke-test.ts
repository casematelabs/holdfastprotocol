/**
 * CAS-369: Devnet Smoke Test — Verify all Holdfast Protocol instructions post-deployment
 *
 * Runs against the live devnet deployment. Exercises the full instruction set
 * and cross-references indexer events.
 *
 * Prerequisites:
 *   - ~/.config/solana/devnet.json        (funded payer, >= 0.5 SOL)
 *   - ~/.config/solana/oracle-devnet.json  (oracle authority keypair)
 *   - Holdfast programs deployed on devnet
 *   - Indexer running at INDEXER_URL
 *
 * Run:
 *   npx ts-node --transpile-only -P tsconfig.json scripts/devnet-smoke-test.ts
 */

import * as anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
import type { VaultpactEscrow } from "../target/types/vaultpact_escrow";
import type { Vaultpact } from "../target/types/vaultpact";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { p256 } = require("../oracle/node_modules/@noble/curves/nist.js");

// ── Config ───────────────────────────────────────────────────────────────────

const RPC_URL = process.env["ANCHOR_PROVIDER_URL"] ?? "https://api.devnet.solana.com";
const INDEXER_URL = process.env["INDEXER_URL"] ?? "https://holdfast-indexer.fly.dev";
const HOLDFAST_PROGRAM_ID = new anchor.web3.PublicKey(
  process.env["HOLDFAST_PROGRAM_ID"] ?? "D6mUa4wGtFyLyJorMfxoKvA9ybohjUSsfw88t66ATxg",
);
const ESCROW_PROGRAM_ID = new anchor.web3.PublicKey(
  process.env["ESCROW_PROGRAM_ID"] ?? "CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi",
);

const TOKEN_PROGRAM_ID = new anchor.web3.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new anchor.web3.PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSVAR_INSTRUCTIONS = new anchor.web3.PublicKey("Sysvar1nstructions1111111111111111111111111");
const SECP256R1_PROGRAM_ID = new anchor.web3.PublicKey(
  Buffer.from([
    6, 146, 13, 236, 47, 234, 113, 181, 183, 35, 129, 77, 116, 45, 169, 3,
    28, 131, 231, 95, 219, 121, 93, 86, 142, 117, 71, 128, 32, 0, 0, 0,
  ]),
);

const MINT_SIZE = 82;
const TOKEN_ACCOUNT_SIZE = 165;

// ── Results tracker ──────────────────────────────────────────────────────────

interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
  txSig?: string;
}

const results: TestResult[] = [];

function record(name: string, pass: boolean, detail: string, txSig?: string) {
  results.push({ name, pass, detail, txSig });
  const icon = pass ? "PASS" : "FAIL";
  console.log(`  [${icon}] ${name}`);
  if (detail) console.log(`         ${detail}`);
  if (txSig) console.log(`         tx: https://explorer.solana.com/tx/${txSig}?cluster=devnet`);
}

// ── SPL Token helpers (no external dependency) ───────────────────────────────

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

// ── Secp256r1 helpers ────────────────────────────────────────────────────────

function buildSecp256r1Instruction(
  sig: Uint8Array,
  compressedPubkey: Uint8Array,
  message: Buffer,
): anchor.web3.TransactionInstruction {
  const SIG_OFFSET = 16;
  const PUBKEY_OFFSET = SIG_OFFSET + 64;
  const MSG_OFFSET = PUBKEY_OFFSET + 33;
  const data = Buffer.alloc(MSG_OFFSET + message.length);
  data[0] = 1;
  data[1] = 0;
  data.writeUInt16LE(SIG_OFFSET, 2);
  data.writeUInt16LE(0xffff, 4);
  data.writeUInt16LE(PUBKEY_OFFSET, 6);
  data.writeUInt16LE(0xffff, 8);
  data.writeUInt16LE(MSG_OFFSET, 10);
  data.writeUInt16LE(message.length, 12);
  data.writeUInt16LE(0xffff, 14);
  Buffer.from(sig).copy(data, SIG_OFFSET);
  Buffer.from(compressedPubkey).copy(data, PUBKEY_OFFSET);
  message.copy(data, MSG_OFFSET);
  return new anchor.web3.TransactionInstruction({ programId: SECP256R1_PROGRAM_ID, keys: [], data });
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

function assertSecpRegistrationMessage(
  ix: anchor.web3.TransactionInstruction,
  expectedMessage: Buffer,
): void {
  const encodedMessageOffset = ix.data.readUInt16LE(10);
  const encodedMessageLength = ix.data.readUInt16LE(12);
  const encodedMessage = ix.data.subarray(
    encodedMessageOffset,
    encodedMessageOffset + encodedMessageLength,
  );
  if (!encodedMessage.equals(expectedMessage)) {
    throw new Error("registration secp256r1 message drift: expected raw registration preimage bytes");
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadKeypair(filePath: string): anchor.web3.Keypair {
  const resolved = filePath.replace(/^~/, os.homedir());
  const raw = JSON.parse(fs.readFileSync(resolved, "utf8")) as number[];
  return anchor.web3.Keypair.fromSecretKey(Uint8Array.from(raw));
}

function generateEscrowId(): number[] {
  return Array.from(crypto.randomBytes(32));
}

function deriveEscrowPdas(escrowId: number[]) {
  const idBuffer = Buffer.from(escrowId);
  const [escrowPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), idBuffer], ESCROW_PROGRAM_ID,
  );
  const [pactPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("pact"), idBuffer], ESCROW_PROGRAM_ID,
  );
  const [disputePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("dispute"), idBuffer], ESCROW_PROGRAM_ID,
  );
  return { escrowPda, pactPda, disputePda };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n================================================================");
  console.log("  CAS-369: Holdfast Protocol — Devnet Smoke Test");
  console.log("================================================================\n");

  // ── Setup ────────────────────────────────────────────────────────────────

  console.log("[Setup] Loading keypairs and connecting...");

  const payerKeypair = loadKeypair("~/.config/solana/devnet.json");
  const oracleKeypair = loadKeypair("~/.config/solana/oracle-devnet.json");

  const connection = new anchor.web3.Connection(RPC_URL, "confirmed");
  const wallet = new anchor.Wallet(payerKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const holdfastIdl = require("../target/idl/vaultpact.json");
  const escrowIdl = require("../target/idl/vaultpact_escrow.json");

  const holdfastProgram = new anchor.Program<Vaultpact>(holdfastIdl, provider) as Program<Vaultpact>;
  const escrowProgram = new anchor.Program<VaultpactEscrow>(escrowIdl, provider) as Program<VaultpactEscrow>;

  const [registryPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("attestation_registry")], HOLDFAST_PROGRAM_ID,
  );
  const [escrowAuthority] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vp_escrow_authority")], ESCROW_PROGRAM_ID,
  );

  const payerBalance = await connection.getBalance(payerKeypair.publicKey);
  console.log(`  Payer: ${payerKeypair.publicKey.toBase58()} (${(payerBalance / anchor.web3.LAMPORTS_PER_SOL).toFixed(4)} SOL)`);
  console.log(`  Oracle: ${oracleKeypair.publicKey.toBase58()}`);
  console.log(`  RPC: ${RPC_URL}`);
  console.log(`  Indexer: ${INDEXER_URL}`);
  console.log(`  Holdfast Program: ${HOLDFAST_PROGRAM_ID.toBase58()}`);
  console.log(`  Escrow Program: ${ESCROW_PROGRAM_ID.toBase58()}`);

  if (payerBalance < 0.1 * anchor.web3.LAMPORTS_PER_SOL) {
    console.log("  Requesting airdrop...");
    const sig = await connection.requestAirdrop(payerKeypair.publicKey, 2 * anchor.web3.LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
    console.log("  Airdrop confirmed");
  }

  // Generate test participants
  const initiator = anchor.web3.Keypair.generate();
  const beneficiary = anchor.web3.Keypair.generate();
  const arbiter = anchor.web3.Keypair.generate();

  console.log("[Setup] Funding test participants...");
  for (const kp of [initiator, beneficiary, arbiter]) {
    const fundTx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: payerKeypair.publicKey,
        toPubkey: kp.publicKey,
        lamports: 0.1 * anchor.web3.LAMPORTS_PER_SOL,
      }),
    );
    await provider.sendAndConfirm(fundTx, []);
  }

  // Ensure attestation registry exists
  console.log("[Setup] Ensuring attestation registry...");
  try {
    await holdfastProgram.methods.initializeRegistry().accounts({
      attestationRegistry: registryPda,
      authority: payerKeypair.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
      escrowProgram: ESCROW_PROGRAM_ID,
    }).rpc();
  } catch (err: any) {
    if (err.error?.errorCode?.code === "ConstraintSeeds") {
      const compared = err.error?.comparedValues as anchor.web3.PublicKey[] | undefined;
      const left = compared?.[0]?.toBase58?.() ?? "unknown";
      const right = compared?.[1]?.toBase58?.() ?? "unknown";
      throw new Error(
        [
          "Attestation registry seed mismatch on devnet.",
          `Configured holdfast=${HOLDFAST_PROGRAM_ID.toBase58()} escrow=${ESCROW_PROGRAM_ID.toBase58()}.`,
          `Program compared seeds left=${left} right=${right}.`,
          "Set HOLDFAST_PROGRAM_ID and ESCROW_PROGRAM_ID env vars to the deployed pair and rerun.",
        ].join(" "),
      );
    }
    if (!err.message?.includes("already in use")) throw err;
    console.log("  Registry already initialized");
  }

  // Register agent wallets (secp256r1)
  console.log("[Setup] Registering agent wallets...");

  async function registerAgentWallet(authority: anchor.web3.Keypair): Promise<{
    walletPda: anchor.web3.PublicKey; pubkeyX: Buffer; pubkeyY: Buffer;
  }> {
    const privKey = p256.utils.randomPrivateKey();
    const uncompressed: Uint8Array = p256.getPublicKey(privKey, false);
    const compressedPubkey: Uint8Array = p256.getPublicKey(privKey, true);
    const pubkeyX = Buffer.from(uncompressed.slice(1, 33));
    const pubkeyY = Buffer.from(uncompressed.slice(33, 65));

    const [walletPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("agent_wallet"), pubkeyX, pubkeyY], HOLDFAST_PROGRAM_ID,
    );

    const preimage = buildRegistrationPreimage(authority.publicKey, pubkeyX, pubkeyY);
    const preimageHash = crypto.createHash("sha256").update(preimage).digest();
    const sigBytes = p256.sign(preimageHash, privKey).toCompactRawBytes();

    // Canonical compatibility path:
    // - Signature over sha256(preimage)
    // - secp256r1 precompile message payload is raw preimage bytes
    const secp256r1Ix = buildSecp256r1Instruction(sigBytes, compressedPubkey, preimage);
    assertSecpRegistrationMessage(secp256r1Ix, preimage);
    const registerIx = await holdfastProgram.methods
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
    return { walletPda, pubkeyX, pubkeyY };
  }

  let initiatorWalletPda: anchor.web3.PublicKey;
  let beneficiaryWalletPda: anchor.web3.PublicKey;
  let arbiterWalletPda: anchor.web3.PublicKey;

  try {
    const [iW, bW, aW] = await Promise.all([
      registerAgentWallet(initiator),
      registerAgentWallet(beneficiary),
      registerAgentWallet(arbiter),
    ]);
    initiatorWalletPda = iW.walletPda;
    beneficiaryWalletPda = bW.walletPda;
    arbiterWalletPda = aW.walletPda;
    console.log("  Agent wallets registered");
  } catch (err: any) {
    console.error("  FATAL: Agent wallet registration failed:", err.message?.slice(0, 120));
    console.error("  secp256r1 precompile may not be active on devnet. Aborting.");
    process.exit(1);
  }

  // Init reputation accounts
  console.log("[Setup] Initializing reputation accounts...");

  async function initReputation(agent: anchor.web3.Keypair): Promise<anchor.web3.PublicKey> {
    const [repPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("reputation"), agent.publicKey.toBuffer()], HOLDFAST_PROGRAM_ID,
    );
    await holdfastProgram.methods.initReputation().accounts({
      reputationAccount: repPda,
      agent: agent.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([agent]).rpc();
    return repPda;
  }

  const [initiatorRepPda, beneficiaryRepPda] = await Promise.all([
    initReputation(initiator),
    initReputation(beneficiary),
  ]);

  // Create SPL Token mint and token accounts
  console.log("[Setup] Creating SPL Token mint and accounts...");

  const mintKeypair = anchor.web3.Keypair.generate();
  const mintRent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  await provider.sendAndConfirm(
    new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.createAccount({
        fromPubkey: payerKeypair.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: MINT_SIZE,
        lamports: mintRent,
        programId: TOKEN_PROGRAM_ID,
      }),
      splInitMint2Ix(mintKeypair.publicKey, 6, payerKeypair.publicKey, null),
    ),
    [mintKeypair],
  );

  const iTokenAcct = anchor.web3.Keypair.generate();
  const bTokenAcct = anchor.web3.Keypair.generate();
  const tokenRent = await connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE);

  for (const [acct, owner] of [[iTokenAcct, initiator.publicKey], [bTokenAcct, beneficiary.publicKey]] as const) {
    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        anchor.web3.SystemProgram.createAccount({
          fromPubkey: payerKeypair.publicKey,
          newAccountPubkey: acct.publicKey,
          space: TOKEN_ACCOUNT_SIZE,
          lamports: tokenRent,
          programId: TOKEN_PROGRAM_ID,
        }),
        splInitAccount3Ix(acct.publicKey, mintKeypair.publicKey, owner),
      ),
      [acct],
    );
  }

  const walletKeypair = anchor.web3.Keypair.fromSecretKey(
    (provider.wallet as anchor.Wallet).payer.secretKey,
  );
  for (const acct of [iTokenAcct, bTokenAcct]) {
    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        splMintToIx(mintKeypair.publicKey, acct.publicKey, payerKeypair.publicKey, 10_000_000),
      ),
      [walletKeypair],
    );
  }

  console.log("  Mint + token accounts ready\n");

  // ── Test 1: createEscrow (initialize_escrow + deposit_funds) ─────────────

  console.log("── Test 1: createEscrow ─────────────────────────────────────");

  const escrowId1 = generateEscrowId();
  const { escrowPda: escrowPda1, pactPda: pactPda1 } = deriveEscrowPdas(escrowId1);
  const vaultAta1 = getAssociatedTokenAddress(mintKeypair.publicKey, escrowPda1);
  const timeLock1 = Math.floor(Date.now() / 1000) + 3600;

  try {
    const initSig = await escrowProgram.methods.initializeEscrow({
      escrowId: escrowId1,
      beneficiary: beneficiary.publicKey,
      arbiter: arbiter.publicKey,
      escrowAmount: new anchor.BN(1_000_000),
      initiatorStake: new anchor.BN(100_000),
      beneficiaryStake: new anchor.BN(100_000),
      timeLockExpiresAt: new anchor.BN(timeLock1),
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
    }).accounts({
      initiator: initiator.publicKey,
      escrowAccount: escrowPda1,
      pactRecord: pactPda1,
      mint: mintKeypair.publicKey,
      vault: vaultAta1,
      initiatorReputation: initiatorRepPda,
      initiatorWallet: initiatorWalletPda,
      beneficiaryWallet: beneficiaryWalletPda,
      arbiterWallet: arbiterWalletPda,
      vaultpactProgram: holdfastProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([initiator]).rpc();

    const escrow = await escrowProgram.account.escrowAccount.fetch(escrowPda1);
    const statusOk = "pending" in escrow.status;

    // deposit_funds
    const depSig = await escrowProgram.methods.depositFunds().accounts({
      initiator: initiator.publicKey,
      escrowAccount: escrowPda1,
      initiatorTokenAccount: iTokenAcct.publicKey,
      vault: vaultAta1,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([initiator]).rpc();

    const escrowFunded = await escrowProgram.account.escrowAccount.fetch(escrowPda1);
    const fundedOk = "funded" in escrowFunded.status;

    record("1. createEscrow (init + deposit)", statusOk && fundedOk,
      `Pending=${statusOk}, Funded=${fundedOk}`, depSig);
  } catch (err: any) {
    record("1. createEscrow (init + deposit)", false, err.message?.slice(0, 200));
  }

  // ── Test 2: releaseEscrow (stake → lock → release) ───────────────────────

  console.log("\n── Test 2: releaseEscrow ────────────────────────────────────");

  try {
    // stake_beneficiary
    await escrowProgram.methods.stakeBeneficiary().accounts({
      beneficiary: beneficiary.publicKey,
      escrowAccount: escrowPda1,
      pactRecord: pactPda1,
      beneficiaryTokenAccount: bTokenAcct.publicKey,
      vault: vaultAta1,
      beneficiaryReputation: beneficiaryRepPda,
      beneficiaryWallet: beneficiaryWalletPda,
      vaultpactProgram: holdfastProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([beneficiary]).rpc();

    // lock_escrow
    await escrowProgram.methods.lockEscrow().accounts({
      initiator: initiator.publicKey,
      beneficiary: beneficiary.publicKey,
      escrowAccount: escrowPda1,
      pactRecord: pactPda1,
      vault: vaultAta1,
      initiatorWallet: initiatorWalletPda,
      beneficiaryWallet: beneficiaryWalletPda,
      arbiterWallet: arbiterWalletPda,
      initiatorReputation: initiatorRepPda,
      beneficiaryReputation: beneficiaryRepPda,
      vaultpactProgram: holdfastProgram.programId,
    }).signers([initiator, beneficiary]).rpc();

    // release_escrow
    const relSig = await escrowProgram.methods.releaseEscrow().accounts({
      initiator: initiator.publicKey,
      escrowAccount: escrowPda1,
      pactRecord: pactPda1,
      initiatorWallet: initiatorWalletPda,
    }).signers([initiator]).rpc();

    const escrowRel = await escrowProgram.account.escrowAccount.fetch(escrowPda1);
    const relOk = "released" in escrowRel.status;
    const windowOk = escrowRel.disputeWindowEndsAt.toNumber() > 0;

    record("2. releaseEscrow (stake → lock → release)", relOk && windowOk,
      `Released=${relOk}, DisputeWindow=${windowOk}`, relSig);
  } catch (err: any) {
    record("2. releaseEscrow (stake → lock → release)", false, err.message?.slice(0, 200));
  }

  // ── Test 3: disputeEscrow ────────────────────────────────────────────────

  console.log("\n── Test 3: disputeEscrow ────────────────────────────────────");

  const escrowId3 = generateEscrowId();
  const { escrowPda: escrowPda3, pactPda: pactPda3, disputePda: disputePda3 } = deriveEscrowPdas(escrowId3);
  const vaultAta3 = getAssociatedTokenAddress(mintKeypair.publicKey, escrowPda3);

  try {
    // init → deposit → stake → lock (setup for dispute)
    await escrowProgram.methods.initializeEscrow({
      escrowId: escrowId3,
      beneficiary: beneficiary.publicKey,
      arbiter: arbiter.publicKey,
      escrowAmount: new anchor.BN(500_000),
      initiatorStake: new anchor.BN(50_000),
      beneficiaryStake: new anchor.BN(50_000),
      timeLockExpiresAt: new anchor.BN(Math.floor(Date.now() / 1000) + 3600),
      deliverablesHash: Array(32).fill(2),
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
      initiator: initiator.publicKey,
      escrowAccount: escrowPda3,
      pactRecord: pactPda3,
      mint: mintKeypair.publicKey,
      vault: vaultAta3,
      initiatorReputation: initiatorRepPda,
      initiatorWallet: initiatorWalletPda,
      beneficiaryWallet: beneficiaryWalletPda,
      arbiterWallet: arbiterWalletPda,
      vaultpactProgram: holdfastProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([initiator]).rpc();

    await escrowProgram.methods.depositFunds().accounts({
      initiator: initiator.publicKey,
      escrowAccount: escrowPda3,
      initiatorTokenAccount: iTokenAcct.publicKey,
      vault: vaultAta3,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([initiator]).rpc();

    await escrowProgram.methods.stakeBeneficiary().accounts({
      beneficiary: beneficiary.publicKey,
      escrowAccount: escrowPda3,
      pactRecord: pactPda3,
      beneficiaryTokenAccount: bTokenAcct.publicKey,
      vault: vaultAta3,
      beneficiaryReputation: beneficiaryRepPda,
      beneficiaryWallet: beneficiaryWalletPda,
      vaultpactProgram: holdfastProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([beneficiary]).rpc();

    await escrowProgram.methods.lockEscrow().accounts({
      initiator: initiator.publicKey,
      beneficiary: beneficiary.publicKey,
      escrowAccount: escrowPda3,
      pactRecord: pactPda3,
      vault: vaultAta3,
      initiatorWallet: initiatorWalletPda,
      beneficiaryWallet: beneficiaryWalletPda,
      arbiterWallet: arbiterWalletPda,
      initiatorReputation: initiatorRepPda,
      beneficiaryReputation: beneficiaryRepPda,
      vaultpactProgram: holdfastProgram.programId,
    }).signers([initiator, beneficiary]).rpc();

    // raise_dispute
    const disputeSig = await escrowProgram.methods.raiseDispute({
      evidenceHash: Array(32).fill(0xAA),
      evidenceUri: Array(128).fill(0),
    }).accounts({
      raiser: beneficiary.publicKey,
      escrowAccount: escrowPda3,
      pactRecord: pactPda3,
      disputeRecord: disputePda3,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([beneficiary]).rpc();

    const escrowDisputed = await escrowProgram.account.escrowAccount.fetch(escrowPda3);
    const disputeOk = "disputed" in escrowDisputed.status;
    const disputeRec = await escrowProgram.account.disputeRecord.fetch(disputePda3);
    const deadlineOk = disputeRec.resolutionDeadline.toNumber() > 0;

    record("3. disputeEscrow (raise_dispute)", disputeOk && deadlineOk,
      `Disputed=${disputeOk}, Deadline=${deadlineOk}`, disputeSig);
  } catch (err: any) {
    record("3. disputeEscrow (raise_dispute)", false, err.message?.slice(0, 200));
  }

  // ── Test 4: cancelPendingEscrow (CAS-351) ────────────────────────────────

  console.log("\n── Test 4: cancelPendingEscrow ──────────────────────────────");

  const escrowId4 = generateEscrowId();
  const { escrowPda: escrowPda4, pactPda: pactPda4 } = deriveEscrowPdas(escrowId4);
  const vaultAta4 = getAssociatedTokenAddress(mintKeypair.publicKey, escrowPda4);
  // Set timelock in the past so cancel_pending_escrow is valid
  const pastTimeLock = Math.floor(Date.now() / 1000) - 60;

  try {
    await escrowProgram.methods.initializeEscrow({
      escrowId: escrowId4,
      beneficiary: beneficiary.publicKey,
      arbiter: arbiter.publicKey,
      escrowAmount: new anchor.BN(200_000),
      initiatorStake: new anchor.BN(0),
      beneficiaryStake: new anchor.BN(0),
      timeLockExpiresAt: new anchor.BN(pastTimeLock),
      deliverablesHash: Array(32).fill(3),
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
      escrowAccount: escrowPda4,
      pactRecord: pactPda4,
      mint: mintKeypair.publicKey,
      vault: vaultAta4,
      initiatorReputation: initiatorRepPda,
      initiatorWallet: initiatorWalletPda,
      beneficiaryWallet: beneficiaryWalletPda,
      arbiterWallet: arbiterWalletPda,
      vaultpactProgram: holdfastProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    }).signers([initiator]).rpc();

    // deposit first (cancel_pending requires Funded status)
    await escrowProgram.methods.depositFunds().accounts({
      initiator: initiator.publicKey,
      escrowAccount: escrowPda4,
      initiatorTokenAccount: iTokenAcct.publicKey,
      vault: vaultAta4,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([initiator]).rpc();

    // cancel_pending_escrow
    const cancelSig = await escrowProgram.methods.cancelPendingEscrow().accounts({
      initiator: initiator.publicKey,
      escrowAccount: escrowPda4,
      vault: vaultAta4,
      initiatorTokenAccount: iTokenAcct.publicKey,
      beneficiaryTokenAccount: bTokenAcct.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
    }).signers([initiator]).rpc();

    const escrowCancelled = await escrowProgram.account.escrowAccount.fetch(escrowPda4);
    const cancelOk = "refunded" in escrowCancelled.status;
    const cancelAtOk = escrowCancelled.cancelledAt.toNumber() > 0;

    record("4. cancelPendingEscrow (CAS-351)", cancelOk && cancelAtOk,
      `Refunded=${cancelOk}, CancelledAt=${cancelAtOk}`, cancelSig);
  } catch (err: any) {
    record("4. cancelPendingEscrow (CAS-351)", false, err.message?.slice(0, 200));
  }

  // ── Test 5: Oracle reputation update ─────────────────────────────────────

  console.log("\n── Test 5: Oracle reputation update ─────────────────────────");

  try {
    const repBefore = await holdfastProgram.account.reputationAccount.fetch(initiatorRepPda);
    const scoreBefore = (repBefore.score as anchor.BN).toNumber();
    const nonceBefore = (repBefore.nonce as anchor.BN).toNumber();
    const pactId = Array.from(crypto.randomBytes(7));

    const repSig = await holdfastProgram.methods.updateReputation(
      new anchor.BN(nonceBefore + 1),
      { fulfilled: {} },
      200,
      pactId,
    ).accounts({
      reputationAccount: initiatorRepPda,
      updateAuthority: oracleKeypair.publicKey,
    }).signers([oracleKeypair]).rpc();

    const repAfter = await holdfastProgram.account.reputationAccount.fetch(initiatorRepPda);
    const scoreAfter = (repAfter.score as anchor.BN).toNumber();
    const deltaOk = scoreAfter === scoreBefore + 200;

    record("5. Oracle reputation update", deltaOk,
      `Score: ${scoreBefore} -> ${scoreAfter} (delta=+200, expected=${deltaOk})`, repSig);
  } catch (err: any) {
    record("5. Oracle reputation update", false, err.message?.slice(0, 200));
  }

  // ── Test 6: Cross-reference indexer events ───────────────────────────────

  console.log("\n── Test 6: Cross-reference indexer events ───────────────────");

  // Wait for indexer to catch up
  console.log("  Waiting 5s for indexer to process events...");
  await sleep(5000);

  const escrowIdHex1 = Buffer.from(escrowId1).toString("hex");

  try {
    // 6a: Indexer health check
    const healthRes = await fetch(`${INDEXER_URL}/health`, { signal: AbortSignal.timeout(10000) });
    if (!healthRes.ok) throw new Error(`Health check returned ${healthRes.status}`);
    const healthData = await healthRes.json() as { status: string };
    record("6a. Indexer health check", healthData.status === "ok" || healthData.status === "degraded",
      `status=${healthData.status}`);
  } catch (err: any) {
    record("6a. Indexer health check", false, `Could not reach indexer: ${err.message?.slice(0, 100)}`);
  }

  try {
    // 6b: Escrow events for test 1 escrow (should have initialized, funded events)
    const eventsUrl = `${INDEXER_URL}/v1/escrows/${escrowIdHex1}/events?limit=20`;
    const eventsRes = await fetch(eventsUrl, { signal: AbortSignal.timeout(10000) });
    if (!eventsRes.ok) throw new Error(`Events returned ${eventsRes.status}`);
    const eventsData = await eventsRes.json() as { events: Array<{ kind: string }>; total: number };
    const kinds = eventsData.events.map((e) => e.kind);
    const hasInit = kinds.includes("initialized");
    const hasFunded = kinds.includes("funded");

    record("6b. Escrow events (escrow #1)", hasInit && hasFunded,
      `Events: [${kinds.join(", ")}], hasInit=${hasInit}, hasFunded=${hasFunded}`);
  } catch (err: any) {
    record("6b. Escrow events (escrow #1)", false, `${err.message?.slice(0, 150)}`);
  }

  try {
    // 6c: Reputation history for initiator
    const histUrl = `${INDEXER_URL}/v1/agents/${initiator.publicKey.toBase58()}/reputation/history?limit=5`;
    const histRes = await fetch(histUrl, { signal: AbortSignal.timeout(10000) });
    if (!histRes.ok) throw new Error(`History returned ${histRes.status}`);
    const histData = await histRes.json() as { entries: Array<{ outcome: number; scoreDelta: number }> };
    const hasEntries = histData.entries.length > 0;

    record("6c. Reputation history (indexer)", hasEntries,
      `Entries: ${histData.entries.length}`);
  } catch (err: any) {
    record("6c. Reputation history (indexer)", false, `${err.message?.slice(0, 150)}`);
  }

  // ── Summary ────────────────────────────────────────────────────────────────

  console.log("\n================================================================");
  console.log("  SMOKE TEST SUMMARY");
  console.log("================================================================\n");

  let passCount = 0;
  let failCount = 0;
  for (const r of results) {
    const icon = r.pass ? "PASS" : "FAIL";
    console.log(`  [${icon}] ${r.name}`);
    if (r.pass) passCount++;
    else failCount++;
  }

  console.log(`\n  Total: ${results.length}  |  Passed: ${passCount}  |  Failed: ${failCount}`);

  if (failCount > 0) {
    console.log("\n  *** FAILURES DETECTED — open bug issues and ping CTO ***");
  } else {
    console.log("\n  All instructions verified on devnet.");
  }

  console.log("\n================================================================\n");

  // Return exit code for CI
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error("\n[smoke-test] Fatal error:", err);
  process.exit(1);
});

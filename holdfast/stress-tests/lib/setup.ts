import * as anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
import type { VaultpactEscrow } from "../../target/types/vaultpact_escrow";
import type { Vaultpact } from "../../target/types/vaultpact";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { p256 } = require("../../oracle/node_modules/@noble/curves/nist.js");

export const TOKEN_PROGRAM_ID = new anchor.web3.PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
export const ASSOCIATED_TOKEN_PROGRAM_ID = new anchor.web3.PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
export const SYSVAR_INSTRUCTIONS = new anchor.web3.PublicKey(
  "Sysvar1nstructions1111111111111111111111111",
);
export const SECP256R1_PROGRAM_ID = new anchor.web3.PublicKey(
  Buffer.from([
    6, 146, 13, 236, 47, 234, 113, 181, 183, 35, 129, 77, 116, 45, 169, 3,
    28, 131, 231, 95, 219, 121, 93, 86, 142, 117, 71, 128, 32, 0, 0, 0,
  ]),
);

const VAULTPACT_PROGRAM_ID = new anchor.web3.PublicKey(
  "D6mUa4wGtFyLyJorMfxoKvA9ybohjUSsfw88t66ATxg",
);
const ESCROW_PROGRAM_ID = new anchor.web3.PublicKey(
  "BNxA76z6vjQYtUJXGpH8qjA3wHvtAAqGqL6rvVWH6b3H",
);

const MINT_SIZE = 82;
const TOKEN_ACCOUNT_SIZE = 165;

export interface DevnetContext {
  connection: anchor.web3.Connection;
  payer: anchor.web3.Keypair;
  provider: anchor.AnchorProvider;
  escrowProgram: Program<VaultpactEscrow>;
  holdfastProgram: Program<Vaultpact>;
  registryPda: anchor.web3.PublicKey;
  escrowAuthority: anchor.web3.PublicKey;
}

export interface FundedParticipant {
  keypair: anchor.web3.Keypair;
  walletPda: anchor.web3.PublicKey;
  repPda: anchor.web3.PublicKey;
  tokenAccount: anchor.web3.PublicKey;
}

export function getConcurrency(): number {
  return parseInt(process.env["STRESS_CONCURRENCY"] ?? "5", 10);
}

export function getOutputDir(): string | undefined {
  return process.env["STRESS_OUTPUT_DIR"];
}

export function loadKeypair(filePath: string): anchor.web3.Keypair {
  const resolved = filePath.replace(/^~/, os.homedir());
  const raw = JSON.parse(fs.readFileSync(resolved, "utf8")) as number[];
  return anchor.web3.Keypair.fromSecretKey(Uint8Array.from(raw));
}

export function getRpcUrl(): string {
  return (
    process.env["ANCHOR_PROVIDER_URL"] ?? "https://api.devnet.solana.com"
  );
}

export async function setupDevnetContext(): Promise<DevnetContext> {
  const rpcUrl = getRpcUrl();
  const connection = new anchor.web3.Connection(rpcUrl, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 60_000,
  });

  const walletPath =
    process.env["ANCHOR_WALLET"] ?? "~/.config/solana/devnet.json";
  const payer = loadKeypair(walletPath);
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  anchor.setProvider(provider);

  const escrowIdl = JSON.parse(
    fs.readFileSync(
      require.resolve("../../target/idl/vaultpact_escrow.json"),
      "utf8",
    ),
  );
  const holdfastIdl = JSON.parse(
    fs.readFileSync(
      require.resolve("../../target/idl/vaultpact.json"),
      "utf8",
    ),
  );

  const escrowProgram = new anchor.Program(
    escrowIdl,
    provider,
  ) as unknown as Program<VaultpactEscrow>;
  const holdfastProgram = new anchor.Program(
    holdfastIdl,
    provider,
  ) as unknown as Program<Vaultpact>;

  const [registryPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("attestation_registry")],
    VAULTPACT_PROGRAM_ID,
  );
  const [escrowAuthority] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("vp_escrow_authority")],
    ESCROW_PROGRAM_ID,
  );

  return {
    connection,
    payer,
    provider,
    escrowProgram,
    holdfastProgram,
    registryPda,
    escrowAuthority,
  };
}

export async function confirmAndGetMeta(
  connection: anchor.web3.Connection,
  sig: string,
): Promise<{ slot: number; computeUnits: number | null }> {
  const latestBlockhash = await connection.getLatestBlockhash();
  await connection.confirmTransaction(
    { signature: sig, ...latestBlockhash },
    "confirmed",
  );
  const txMeta = await connection.getTransaction(sig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  const cu = txMeta?.meta?.computeUnitsConsumed ?? null;
  const slot = txMeta?.slot ?? 0;
  return { slot, computeUnits: cu };
}

export function generateEscrowId(): number[] {
  return Array.from(crypto.randomBytes(32));
}

export function deriveEscrowPdas(escrowId: number[]) {
  const idBuffer = Buffer.from(escrowId);
  const [escrowPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("escrow"), idBuffer],
    ESCROW_PROGRAM_ID,
  );
  const [pactPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("pact"), idBuffer],
    ESCROW_PROGRAM_ID,
  );
  const [disputePda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("dispute"), idBuffer],
    ESCROW_PROGRAM_ID,
  );
  return { escrowPda, pactPda, disputePda };
}

export function getAssociatedTokenAddress(
  mint: anchor.web3.PublicKey,
  owner: anchor.web3.PublicKey,
): anchor.web3.PublicKey {
  const [ata] = anchor.web3.PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

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

export async function createSplMint(
  ctx: DevnetContext,
): Promise<anchor.web3.Keypair> {
  const mint = anchor.web3.Keypair.generate();
  const rent = await ctx.connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  const tx = new anchor.web3.Transaction().add(
    anchor.web3.SystemProgram.createAccount({
      fromPubkey: ctx.payer.publicKey,
      newAccountPubkey: mint.publicKey,
      space: MINT_SIZE,
      lamports: rent,
      programId: TOKEN_PROGRAM_ID,
    }),
    splInitMint2Ix(mint.publicKey, 6, ctx.payer.publicKey, null),
  );
  await ctx.provider.sendAndConfirm(tx, [mint]);
  return mint;
}

export async function createTokenAccount(
  ctx: DevnetContext,
  mint: anchor.web3.PublicKey,
  owner: anchor.web3.PublicKey,
): Promise<anchor.web3.Keypair> {
  const account = anchor.web3.Keypair.generate();
  const rent = await ctx.connection.getMinimumBalanceForRentExemption(
    TOKEN_ACCOUNT_SIZE,
  );
  const tx = new anchor.web3.Transaction().add(
    anchor.web3.SystemProgram.createAccount({
      fromPubkey: ctx.payer.publicKey,
      newAccountPubkey: account.publicKey,
      space: TOKEN_ACCOUNT_SIZE,
      lamports: rent,
      programId: TOKEN_PROGRAM_ID,
    }),
    splInitAccount3Ix(account.publicKey, mint, owner),
  );
  await ctx.provider.sendAndConfirm(tx, [account]);
  return account;
}

export async function mintTokens(
  ctx: DevnetContext,
  mint: anchor.web3.PublicKey,
  destination: anchor.web3.PublicKey,
  amount: number,
): Promise<void> {
  const tx = new anchor.web3.Transaction().add(
    splMintToIx(mint, destination, ctx.payer.publicKey, amount),
  );
  await ctx.provider.sendAndConfirm(tx, []);
}

export async function airdropIfNeeded(
  ctx: DevnetContext,
  pubkey: anchor.web3.PublicKey,
  minLamports = 0.05 * anchor.web3.LAMPORTS_PER_SOL,
): Promise<void> {
  const balance = await ctx.connection.getBalance(pubkey);
  if (balance < minLamports) {
    const sig = await ctx.connection.requestAirdrop(
      pubkey,
      anchor.web3.LAMPORTS_PER_SOL,
    );
    await ctx.connection.confirmTransaction(sig);
  }
}

export async function registerAgentWallet(
  ctx: DevnetContext,
  authority: anchor.web3.Keypair,
): Promise<{ walletPda: anchor.web3.PublicKey; pubkeyX: Buffer; pubkeyY: Buffer }> {
  const privKey = p256.utils.randomPrivateKey();
  const uncompressed: Uint8Array = p256.getPublicKey(privKey, false);
  const compressedPubkey: Uint8Array = p256.getPublicKey(privKey, true);
  const pubkeyX = Buffer.from(uncompressed.slice(1, 33));
  const pubkeyY = Buffer.from(uncompressed.slice(33, 65));

  const [walletPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("agent_wallet"), pubkeyX, pubkeyY],
    ctx.holdfastProgram.programId,
  );

  const preimage = Buffer.concat([
    Buffer.from("vaultpact:register_agent_wallet:v1:"),
    authority.publicKey.toBuffer(),
    pubkeyX,
    pubkeyY,
  ]);
  const preimageHash = crypto.createHash("sha256").update(preimage).digest();
  const sigBytes = p256.sign(preimageHash, privKey).toCompactRawBytes();

  const secp256r1Ix = buildSecp256r1Instruction(
    sigBytes,
    compressedPubkey,
    preimage,
  );

  const registerIx = await ctx.holdfastProgram.methods
    .registerAgentWallet(
      Array.from(pubkeyX) as number[],
      Array.from(pubkeyY) as number[],
    )
    .accounts({
      agentWallet: walletPda,
      attestationRegistry: ctx.registryPda,
      payer: authority.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
      instructions: SYSVAR_INSTRUCTIONS,
    })
    .signers([authority])
    .instruction();

  const tx = new anchor.web3.Transaction().add(secp256r1Ix, registerIx);
  await ctx.provider.sendAndConfirm(tx, [authority]);

  return { walletPda, pubkeyX, pubkeyY };
}

export async function initReputation(
  ctx: DevnetContext,
  agent: anchor.web3.Keypair,
): Promise<anchor.web3.PublicKey> {
  const [repPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("reputation"), agent.publicKey.toBuffer()],
    ctx.holdfastProgram.programId,
  );
  await ctx.holdfastProgram.methods
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

export async function setupParticipant(
  ctx: DevnetContext,
  mint: anchor.web3.PublicKey,
  tokenAmount: number,
): Promise<FundedParticipant> {
  const keypair = anchor.web3.Keypair.generate();
  await airdropIfNeeded(ctx, keypair.publicKey, 0.1 * anchor.web3.LAMPORTS_PER_SOL);
  const { walletPda } = await registerAgentWallet(ctx, keypair);
  const repPda = await initReputation(ctx, keypair);
  const tokenAccountKp = await createTokenAccount(ctx, mint, keypair.publicKey);
  if (tokenAmount > 0) {
    await mintTokens(ctx, mint, tokenAccountKp.publicKey, tokenAmount);
  }
  return {
    keypair,
    walletPda,
    repPda,
    tokenAccount: tokenAccountKp.publicKey,
  };
}

export function printSummary(summary: Record<string, unknown>): void {
  console.log("\n" + "=".repeat(60));
  console.log("  STRESS TEST RESULTS");
  console.log("=".repeat(60));
  for (const [key, value] of Object.entries(summary)) {
    const label = key.padEnd(24);
    const val =
      typeof value === "number"
        ? key.includes("Rate")
          ? `${(value * 100).toFixed(1)}%`
          : key.includes("Ms") || key.includes("duration")
            ? `${value.toFixed(0)}ms`
            : key.includes("tps")
              ? value.toFixed(2)
              : String(value)
        : String(value ?? "-");
    console.log(`  ${label} ${val}`);
  }
  console.log("=".repeat(60) + "\n");
}

export async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results: T[] = [];
  let idx = 0;

  async function worker(): Promise<void> {
    while (idx < tasks.length) {
      const taskIdx = idx++;
      results[taskIdx] = await tasks[taskIdx]();
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

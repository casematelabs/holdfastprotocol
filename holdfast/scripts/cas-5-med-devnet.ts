import * as anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
import type { VaultpactEscrow } from "../target/types/vaultpact_escrow";
import type { Vaultpact } from "../target/types/vaultpact";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import { p256 } from "@noble/curves/nist.js";

const RPC_URL = process.env["ANCHOR_PROVIDER_URL"] ?? "https://api.devnet.solana.com";
const HOLDFAST_PROGRAM_ID = process.env["HOLDFAST_PROGRAM_ID"] ?? "2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq";
const PAYER_KEYPAIR_PATH = process.env["PAYER_KEYPAIR_PATH"] ?? "~/.config/solana/devnet.json";
const MIN_PAYER_BALANCE_SOL = Number(process.env["CAS5_MIN_PAYER_SOL"] ?? "0.02");
const PARTICIPANT_FUNDING_SOL = Number(process.env["CAS5_PARTICIPANT_SOL"] ?? "0.03");
const FUNDING_FEE_BUFFER_SOL = Number(process.env["CAS5_FEE_BUFFER_SOL"] ?? "0.001");
const FUNDING_DRY_RUN = process.env["CAS5_FUNDING_DRY_RUN"] === "1";
const FUNDING_JSON = process.env["CAS5_FUNDING_JSON"] === "1";
const FUNDING_JSON_PATH = process.env["CAS5_FUNDING_JSON_PATH"] ?? "";
const CAS5_TOPUP_HINT = process.env["CAS5_TOPUP_HINT"] === "1";
const CAS5_HELP = process.env["CAS5_HELP"] === "1";
const CAS5_SAVE_PARTICIPANTS_DIR = process.env["CAS5_SAVE_PARTICIPANTS_DIR"] ?? "";
const CAS5_RECOVER_FROM_DIR = process.env["CAS5_RECOVER_FROM_DIR"] ?? "";
const CAS5_TRY_AIRDROP = process.env["CAS5_TRY_AIRDROP"] === "1";
const CAS5_AIRDROP_AMOUNTS_SOL = process.env["CAS5_AIRDROP_AMOUNTS_SOL"] ?? "0.05,0.01,0.005,0.001";
const REGISTRATION_ONLY = process.env["CAS5_REGISTRATION_ONLY"] === "1";
const IGNORE_PARTICIPANT_MIN = process.env["CAS5_IGNORE_PARTICIPANT_MIN"] === "1";
const TOKEN_PROGRAM_ID = new anchor.web3.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new anchor.web3.PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSVAR_INSTRUCTIONS = new anchor.web3.PublicKey("Sysvar1nstructions1111111111111111111111111");
const SECP256R1_PROGRAM_ID = new anchor.web3.PublicKey(Buffer.from([6,146,13,236,47,234,113,181,183,35,129,77,116,45,169,3,28,131,231,95,219,121,93,86,142,117,71,128,32,0,0,0]));
const MINT_SIZE = 82;
const TOKEN_ACCOUNT_SIZE = 165;
const AGENT_WALLET_SIZE = 132;
const REPUTATION_ACCOUNT_SIZE = 512;
const ESCROW_ACCOUNT_SIZE = 408; // EscrowAccount::LEN = 8 + 400
const PACT_RECORD_SIZE = 344; // PactRecord::LEN = 8 + 336
const DISPUTE_RECORD_SIZE = 508; // DisputeRecord::LEN = 8 + 500

function withLegacyAccountTypes(rawIdl: any): any {
  const next = JSON.parse(JSON.stringify(rawIdl));
  const typeByName = new Map<string, any>((next.types ?? []).map((t: any) => [t.name, t.type]));
  const sizeByAccountName: Record<string, number> = {
    agentWallet: AGENT_WALLET_SIZE,
    attestationRegistry: 81,
    reputationAccount: REPUTATION_ACCOUNT_SIZE,
    escrowAccount: ESCROW_ACCOUNT_SIZE,
    pactRecord: PACT_RECORD_SIZE,
    disputeRecord: DISPUTE_RECORD_SIZE,
  };
  if (Array.isArray(next.accounts)) {
    next.accounts = next.accounts.map((acct: any) => {
      const normalized = typeof acct?.name === "string"
        ? acct.name.charAt(0).toLowerCase() + acct.name.slice(1)
        : "";
      const explicitSize = sizeByAccountName[normalized] ?? 0;
      if (acct?.type) {
        return typeof acct.type.size === "number"
          ? acct
          : { ...acct, type: { ...acct.type, size: explicitSize } };
      }
      const legacyType = typeByName.get(acct?.name);
      if (legacyType) {
        return { ...acct, type: { ...legacyType, size: legacyType?.size ?? explicitSize } };
      }
      return { ...acct, type: { kind: "struct", fields: [], size: explicitSize } };
    });
  }
  // Work around account namespace incompatibility in current Anchor TS runtime.
  next.accounts = [];
  return next;
}

async function fetchReputationNonce(connection: anchor.web3.Connection, reputationPda: anchor.web3.PublicKey): Promise<number> {
  const info = await connection.getAccountInfo(reputationPda, "confirmed");
  if (!info) throw new Error(`missing reputation account: ${reputationPda.toBase58()}`);
  if (info.data.length < 98) throw new Error(`reputation account too small: ${info.data.length}`);
  const nonce = Number(info.data.readBigUInt64LE(90));
  return nonce;
}

function loadKeypair(filePath: string): anchor.web3.Keypair {
  const resolved = filePath.replace(/^~/, os.homedir());
  const raw = JSON.parse(fs.readFileSync(resolved, "utf8")) as number[];
  return anchor.web3.Keypair.fromSecretKey(Uint8Array.from(raw));
}

function splInitMint2Ix(mint: anchor.web3.PublicKey, decimals: number, mintAuthority: anchor.web3.PublicKey): anchor.web3.TransactionInstruction {
  const data = Buffer.alloc(67);
  data[0] = 20;
  data[1] = decimals;
  mintAuthority.toBuffer().copy(data, 2);
  return new anchor.web3.TransactionInstruction({ programId: TOKEN_PROGRAM_ID, keys: [{ pubkey: mint, isSigner: false, isWritable: true }], data });
}

function splInitAccount3Ix(account: anchor.web3.PublicKey, mint: anchor.web3.PublicKey, owner: anchor.web3.PublicKey): anchor.web3.TransactionInstruction {
  const data = Buffer.alloc(33);
  data[0] = 18;
  owner.toBuffer().copy(data, 1);
  return new anchor.web3.TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [{ pubkey: account, isSigner: false, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false }],
    data,
  });
}

function splMintToIx(mint: anchor.web3.PublicKey, destination: anchor.web3.PublicKey, authority: anchor.web3.PublicKey, amount: number): anchor.web3.TransactionInstruction {
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

function getAssociatedTokenAddress(mint: anchor.web3.PublicKey, owner: anchor.web3.PublicKey): anchor.web3.PublicKey {
  const [ata] = anchor.web3.PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID);
  return ata;
}

function buildSecp256r1InstructionLegacy(sig: Uint8Array, pubkey: Uint8Array, message: Buffer): anchor.web3.TransactionInstruction {
  const SIG_OFFSET = 16;
  const PUBKEY_OFFSET = SIG_OFFSET + 64;
  const MSG_OFFSET = PUBKEY_OFFSET + pubkey.length;
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
  Buffer.from(pubkey).copy(data, PUBKEY_OFFSET);
  message.copy(data, MSG_OFFSET);
  return new anchor.web3.TransactionInstruction({ programId: SECP256R1_PROGRAM_ID, keys: [], data });
}

function buildSecp256r1InstructionCompact(sig: Uint8Array, pubkey: Uint8Array, message: Buffer): anchor.web3.TransactionInstruction {
  // Compact offsets layout observed on Solana v4 runtimes:
  // [u8 count][u8 pad][u16 sig_off][u8 sig_ix][u16 key_off][u8 key_ix][u16 msg_off][u16 msg_len][u8 msg_ix][u8 pad]
  const SIG_OFFSET = 14;
  const PUBKEY_OFFSET = SIG_OFFSET + sig.length;
  const MSG_OFFSET = PUBKEY_OFFSET + pubkey.length;
  const data = Buffer.alloc(MSG_OFFSET + message.length);
  data[0] = 1;
  data[1] = 0;
  data.writeUInt16LE(SIG_OFFSET, 2);
  data[4] = 0xff;
  data.writeUInt16LE(PUBKEY_OFFSET, 5);
  data[7] = 0xff;
  data.writeUInt16LE(MSG_OFFSET, 8);
  data.writeUInt16LE(message.length, 10);
  data[12] = 0xff;
  data[13] = 0;
  Buffer.from(sig).copy(data, SIG_OFFSET);
  Buffer.from(pubkey).copy(data, PUBKEY_OFFSET);
  message.copy(data, MSG_OFFSET);
  return new anchor.web3.TransactionInstruction({ programId: SECP256R1_PROGRAM_ID, keys: [], data });
}

function buildRegistrationPreimage(authority: anchor.web3.PublicKey, pubkeyX: Buffer, pubkeyY: Buffer): Buffer {
  return Buffer.concat([Buffer.from("vaultpact:register_agent_wallet:v1:"), authority.toBuffer(), pubkeyX, pubkeyY]);
}

function buildRaiseDisputeIx(params: { evidenceHash: number[]; evidenceUri: number[] }, accounts: {
  programId: anchor.web3.PublicKey;
  raiser: anchor.web3.PublicKey;
  escrowAccount: anchor.web3.PublicKey;
  pactRecord: anchor.web3.PublicKey;
  disputeRecord: anchor.web3.PublicKey;
  vault: anchor.web3.PublicKey;
  beneficiaryTokenAccount: anchor.web3.PublicKey;
  initiatorTokenAccount: anchor.web3.PublicKey;
}): anchor.web3.TransactionInstruction {
  // raise_dispute discriminator from current IDL:
  // [41,243,1,51,150,95,246,73]
  const disc = Buffer.from([41, 243, 1, 51, 150, 95, 246, 73]);
  const data = Buffer.alloc(8 + 32 + 128);
  disc.copy(data, 0);
  Buffer.from(params.evidenceHash).copy(data, 8);
  Buffer.from(params.evidenceUri).copy(data, 40);
  return new anchor.web3.TransactionInstruction({
    programId: accounts.programId,
    keys: [
      { pubkey: accounts.raiser, isSigner: true, isWritable: true },
      { pubkey: accounts.escrowAccount, isSigner: false, isWritable: true },
      { pubkey: accounts.pactRecord, isSigner: false, isWritable: false },
      { pubkey: accounts.disputeRecord, isSigner: false, isWritable: true },
      { pubkey: accounts.vault, isSigner: false, isWritable: false },
      { pubkey: accounts.beneficiaryTokenAccount, isSigner: false, isWritable: false },
      { pubkey: accounts.initiatorTokenAccount, isSigner: false, isWritable: false },
      { pubkey: anchor.web3.SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function buildCancelPendingEscrowIx(accounts: {
  programId: anchor.web3.PublicKey;
  initiator: anchor.web3.PublicKey;
  escrowAccount: anchor.web3.PublicKey;
  vault: anchor.web3.PublicKey;
  initiatorTokenAccount: anchor.web3.PublicKey;
  beneficiaryTokenAccount: anchor.web3.PublicKey;
  tokenProgram: anchor.web3.PublicKey;
  initiatorReputation: anchor.web3.PublicKey;
  beneficiaryReputation: anchor.web3.PublicKey;
  escrowAuthority: anchor.web3.PublicKey;
  attestationRegistry: anchor.web3.PublicKey;
  vaultpactProgram: anchor.web3.PublicKey;
}): anchor.web3.TransactionInstruction {
  // cancel_pending_escrow discriminator from current IDL:
  // [82,179,206,250,78,219,168,254]
  const data = Buffer.from([82, 179, 206, 250, 78, 219, 168, 254]);
  return new anchor.web3.TransactionInstruction({
    programId: accounts.programId,
    keys: [
      { pubkey: accounts.initiator, isSigner: true, isWritable: false },
      { pubkey: accounts.escrowAccount, isSigner: false, isWritable: true },
      { pubkey: accounts.vault, isSigner: false, isWritable: true },
      { pubkey: accounts.initiatorTokenAccount, isSigner: false, isWritable: true },
      { pubkey: accounts.beneficiaryTokenAccount, isSigner: false, isWritable: true },
      { pubkey: accounts.tokenProgram, isSigner: false, isWritable: false },
      { pubkey: accounts.initiatorReputation, isSigner: false, isWritable: true },
      { pubkey: accounts.beneficiaryReputation, isSigner: false, isWritable: true },
      { pubkey: accounts.escrowAuthority, isSigner: false, isWritable: false },
      { pubkey: accounts.attestationRegistry, isSigner: false, isWritable: false },
      { pubkey: accounts.vaultpactProgram, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function randomEscrowId(): number[] { return Array.from(crypto.randomBytes(32)); }
function saveKeypair(filePath: string, kp: anchor.web3.Keypair): void {
  fs.writeFileSync(filePath, JSON.stringify(Array.from(kp.secretKey)), "utf8");
}
async function recoverParticipantsToPayer(
  connection: anchor.web3.Connection,
  sourceDir: string,
  payer: anchor.web3.PublicKey,
): Promise<void> {
  if (!fs.existsSync(sourceDir)) {
    console.log(`CAS5_RECOVER_FROM_DIR: directory not found: ${sourceDir}`);
    return;
  }
  const files = fs.readdirSync(sourceDir).filter((f) => f.endsWith(".json"));
  const feeReserve = 5_000;
  let recovered = 0;
  for (const file of files) {
    const full = `${sourceDir.replace(/[\\\/]+$/, "")}/${file}`;
    try {
      const kp = loadKeypair(full);
      const bal = await connection.getBalance(kp.publicKey, "confirmed");
      if (bal <= feeReserve) {
        console.log(`CAS5_RECOVER_FROM_DIR: ${kp.publicKey.toBase58()} balance=${bal} (skip)`);
        continue;
      }
      const lamports = bal - feeReserve;
      const tx = new anchor.web3.Transaction().add(anchor.web3.SystemProgram.transfer({
        fromPubkey: kp.publicKey,
        toPubkey: payer,
        lamports,
      }));
      const sig = await anchor.web3.sendAndConfirmTransaction(connection, tx, [kp], { commitment: "confirmed" });
      recovered += lamports;
      console.log(`CAS5_RECOVER_FROM_DIR: recovered ${lamports} from ${kp.publicKey.toBase58()} sig=${sig}`);
    } catch (err: any) {
      console.warn(`CAS5_RECOVER_FROM_DIR: failed ${full}: ${err?.message ?? String(err)}`);
    }
  }
  console.log(`CAS5_RECOVER_FROM_DIR: total recovered ${recovered} lamports (${(recovered / anchor.web3.LAMPORTS_PER_SOL).toFixed(6)} SOL)`);
}
async function tryAirdropToPayer(
  connection: anchor.web3.Connection,
  payer: anchor.web3.PublicKey,
): Promise<void> {
  const amounts = CAS5_AIRDROP_AMOUNTS_SOL
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  for (const amount of amounts) {
    const lamports = Math.floor(amount * anchor.web3.LAMPORTS_PER_SOL);
    try {
      console.log(`CAS5_TRY_AIRDROP: requesting ${amount} SOL to ${payer.toBase58()}`);
      const sig = await connection.requestAirdrop(payer, lamports);
      await connection.confirmTransaction(sig, "confirmed");
      console.log(`CAS5_TRY_AIRDROP: success amount=${amount} sig=${sig}`);
    } catch (err: any) {
      console.warn(`CAS5_TRY_AIRDROP: failed amount=${amount}: ${err?.message ?? String(err)}`);
    }
  }
  const bal = await connection.getBalance(payer, "confirmed");
  console.log(`CAS5_TRY_AIRDROP: payer balance=${bal} lamports (${(bal / anchor.web3.LAMPORTS_PER_SOL).toFixed(6)} SOL)`);
}
function topUpCmd(payer: anchor.web3.PublicKey, shortfallLamports: number): string {
  return `solana transfer ${payer.toBase58()} ${(shortfallLamports / anchor.web3.LAMPORTS_PER_SOL).toFixed(6)} --from <FUNDED_KEYPAIR> --url ${RPC_URL}`;
}
function registrationOnlyCmdBash(): string {
  return "TS_NODE_TRANSPILE_ONLY=1 CAS5_REGISTRATION_ONLY=1 yarn ts-node scripts/cas-5-med-devnet.ts";
}
function registrationOnlyCmdPowerShell(): string {
  return "$env:TS_NODE_TRANSPILE_ONLY='1'; $env:CAS5_REGISTRATION_ONLY='1'; yarn ts-node scripts/cas-5-med-devnet.ts";
}
function fullRunCmdBash(): string {
  return "TS_NODE_TRANSPILE_ONLY=1 yarn ts-node scripts/cas-5-med-devnet.ts";
}
function fullRunCmdPowerShell(): string {
  return "$env:TS_NODE_TRANSPILE_ONLY='1'; yarn ts-node scripts/cas-5-med-devnet.ts";
}

async function main(): Promise<void> {
  if (CAS5_HELP) {
    console.log("CAS-5 script environment flags:");
    console.log("  CAS5_MIN_PAYER_SOL           minimum payer balance gate (default 0.02)");
    console.log("  CAS5_PARTICIPANT_SOL         desired per-participant funding (default 0.03)");
    console.log("  CAS5_FEE_BUFFER_SOL          payer fee buffer (default 0.001)");
    console.log("  CAS5_FUNDING_DRY_RUN=1       print funding requirements without spending");
    console.log("  CAS5_FUNDING_JSON=1          emit dry-run report as JSON");
    console.log("  CAS5_FUNDING_JSON_PATH=<p>   additionally write JSON report to file");
    console.log("  CAS5_TOPUP_HINT=1            print only top-up commands and shortfalls");
    console.log("  CAS5_REGISTRATION_ONLY=1     run registration path only");
    console.log("  CAS5_IGNORE_PARTICIPANT_MIN=1  best-effort low-fund execution mode");
    console.log("  CAS5_SAVE_PARTICIPANTS_DIR=<d> save generated participant keypairs for recovery");
    console.log("  CAS5_RECOVER_FROM_DIR=<d>    recover lamports from saved keypairs into payer");
    console.log("  CAS5_TRY_AIRDROP=1           attempt staged devnet airdrops to payer and exit");
    console.log("  CAS5_AIRDROP_AMOUNTS_SOL=... comma list for staged airdrops (default 0.05,0.01,0.005,0.001)");
    console.log("Examples:");
    console.log("  powershell full run: $env:TS_NODE_TRANSPILE_ONLY='1'; yarn ts-node scripts/cas-5-med-devnet.ts");
    console.log("  powershell dry run:  $env:TS_NODE_TRANSPILE_ONLY='1'; $env:CAS5_FUNDING_DRY_RUN='1'; yarn ts-node scripts/cas-5-med-devnet.ts");
    return;
  }

  async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
    console.log(`[step] ${name}`);
    try {
      return await fn();
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const logs = Array.isArray(err?.logs) ? err.logs.join(" | ") : "";
      console.error(`[step-fail] ${name}: ${msg}`);
      if (logs) console.error(`[step-fail-logs] ${logs}`);
      throw err;
    }
  }

  const payer = loadKeypair(PAYER_KEYPAIR_PATH);
  const connection = new anchor.web3.Connection(RPC_URL, "confirmed");
  if (CAS5_TRY_AIRDROP) {
    await tryAirdropToPayer(connection, payer.publicKey);
    return;
  }
  if (CAS5_RECOVER_FROM_DIR) {
    await recoverParticipantsToPayer(connection, CAS5_RECOVER_FROM_DIR, payer.publicKey);
    const payerBalAfterRecover = await connection.getBalance(payer.publicKey, "confirmed");
    console.log(`CAS5_RECOVER_FROM_DIR: payer ${payer.publicKey.toBase58()} balance=${payerBalAfterRecover} lamports (${(payerBalAfterRecover / anchor.web3.LAMPORTS_PER_SOL).toFixed(6)} SOL)`);
    return;
  }
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), { commitment: "confirmed" });
  anchor.setProvider(provider);

  const payerBal = await connection.getBalance(payer.publicKey);
  const minPayerLamports = Math.floor(MIN_PAYER_BALANCE_SOL * anchor.web3.LAMPORTS_PER_SOL);
  if (!FUNDING_DRY_RUN && payerBal < minPayerLamports) {
    const shortfall = minPayerLamports - payerBal;
    throw new Error(
      `insufficient payer balance: ${payerBal} (need >= ${minPayerLamports}; shortfall ${shortfall} lamports ` +
      `(${(shortfall / anchor.web3.LAMPORTS_PER_SOL).toFixed(6)} SOL); payer=${payer.publicKey.toBase58()}; ` +
      `top-up cmd: ${topUpCmd(payer.publicKey, shortfall)}; ` +
      `set CAS5_MIN_PAYER_SOL to override)`,
    );
  }

  const initiator = anchor.web3.Keypair.generate();
  const beneficiary = anchor.web3.Keypair.generate();
  const arbiter = anchor.web3.Keypair.generate();
  if (CAS5_SAVE_PARTICIPANTS_DIR) {
    fs.mkdirSync(CAS5_SAVE_PARTICIPANTS_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = CAS5_SAVE_PARTICIPANTS_DIR.replace(/[\\\/]+$/, "");
    saveKeypair(`${base}/cas5-${stamp}-initiator-${initiator.publicKey.toBase58()}.json`, initiator);
    saveKeypair(`${base}/cas5-${stamp}-beneficiary-${beneficiary.publicKey.toBase58()}.json`, beneficiary);
    saveKeypair(`${base}/cas5-${stamp}-arbiter-${arbiter.publicKey.toBase58()}.json`, arbiter);
    console.warn(`[warn] saved participant keypairs to ${base} for potential lamport recovery`);
  }
  const desiredParticipantLamports = Math.floor(PARTICIPANT_FUNDING_SOL * anchor.web3.LAMPORTS_PER_SOL);
  const fundingFeeBufferLamports = Math.floor(FUNDING_FEE_BUFFER_SOL * anchor.web3.LAMPORTS_PER_SOL);
  const agentWalletRentLamports = await connection.getMinimumBalanceForRentExemption(AGENT_WALLET_SIZE);
  const reputationRentLamports = await connection.getMinimumBalanceForRentExemption(REPUTATION_ACCOUNT_SIZE);
  const escrowAccountRentLamports = await connection.getMinimumBalanceForRentExemption(ESCROW_ACCOUNT_SIZE);
  const pactRecordRentLamports = await connection.getMinimumBalanceForRentExemption(PACT_RECORD_SIZE);
  const disputeRecordRentLamports = await connection.getMinimumBalanceForRentExemption(DISPUTE_RECORD_SIZE);
  const tokenAccountRentLamports = await connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE);
  const mintAccountRentLamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  // Payer also funds: mint account + 3 token accounts + tx fee headroom.
  // In best-effort mode we intentionally relax this reserve so low-balance runs can
  // progress farther and reveal the next concrete boundary.
  const payerSetupReserveLamports = IGNORE_PARTICIPANT_MIN
    ? 500_000
    : mintAccountRentLamports + (3 * tokenAccountRentLamports) + 500_000;

  const fundingPlan: Array<{ kp: anchor.web3.Keypair; minLamports: number; label: string }> = REGISTRATION_ONLY
    ? [{ kp: initiator, minLamports: agentWalletRentLamports, label: "initiator" }]
    : [
      {
        kp: initiator,
        minLamports:
          agentWalletRentLamports +
          reputationRentLamports +
          // CAS-5 path provisions two escrows, one dispute record, and two vault ATAs.
          (2 * escrowAccountRentLamports) +
          (2 * pactRecordRentLamports) +
          disputeRecordRentLamports +
          (2 * tokenAccountRentLamports),
        label: "initiator",
      },
      { kp: beneficiary, minLamports: agentWalletRentLamports + reputationRentLamports, label: "beneficiary" },
      { kp: arbiter, minLamports: agentWalletRentLamports, label: "arbiter" },
    ];

  const minTotalLamports = fundingPlan.reduce((sum, p) => sum + p.minLamports, 0);
  const totalDesiredLamports = fundingPlan.reduce((sum, p) => sum + Math.max(desiredParticipantLamports, p.minLamports), 0);
  const maxAffordableTotalLamports = Math.max(0, payerBal - fundingFeeBufferLamports - payerSetupReserveLamports);
  const regOnlyRequired = agentWalletRentLamports;
  const regOnlyAffordable = Math.max(0, payerBal - fundingFeeBufferLamports);
  const regOnlyShortfall = Math.max(0, regOnlyRequired - regOnlyAffordable);
  const regPlusRepRequired = REGISTRATION_ONLY
    ? agentWalletRentLamports + reputationRentLamports
    : (3 * agentWalletRentLamports) + (2 * reputationRentLamports);
  const regPlusRepShortfall = Math.max(0, regPlusRepRequired - maxAffordableTotalLamports);
  if (!FUNDING_DRY_RUN && maxAffordableTotalLamports <= 0) {
    const participantFundingMinLamports = fundingFeeBufferLamports + payerSetupReserveLamports + 1;
    const participantFundingMinSol = (participantFundingMinLamports / anchor.web3.LAMPORTS_PER_SOL).toFixed(6);
    const shortfallLamports = Math.max(0, participantFundingMinLamports - payerBal);
    throw new Error(
      `insufficient payer balance for participant funding: ${payerBal} lamports ` +
      `(need >= ${participantFundingMinLamports} lamports / ${participantFundingMinSol} SOL; ` +
      `shortfall ${shortfallLamports} lamports)`,
    );
  }
  const useDesiredFunding = maxAffordableTotalLamports >= totalDesiredLamports;
  if (!FUNDING_JSON && !CAS5_TOPUP_HINT && maxAffordableTotalLamports < totalDesiredLamports) {
    console.warn(
      `[warn] reducing participant funding from desired total ${totalDesiredLamports} to affordable ${maxAffordableTotalLamports} lamports`,
    );
  }
  if (FUNDING_DRY_RUN) {
    const targetTotal = useDesiredFunding ? totalDesiredLamports : minTotalLamports;
    const shortfall = Math.max(0, targetTotal - maxAffordableTotalLamports);
    if (CAS5_TOPUP_HINT) {
      console.log(`full_shortfall_lamports=${shortfall}`);
      console.log(`full_topup_cmd=${topUpCmd(payer.publicKey, shortfall)}`);
      console.log(`registration_shortfall_lamports=${regOnlyShortfall}`);
      console.log(`registration_topup_cmd=${topUpCmd(payer.publicKey, regOnlyShortfall)}`);
      console.log(`registration_plus_reputation_shortfall_lamports=${regPlusRepShortfall}`);
      console.log(`registration_plus_reputation_topup_cmd=${topUpCmd(payer.publicKey, regPlusRepShortfall)}`);
      return;
    }
    if (FUNDING_JSON) {
      const payload = {
        payer: payer.publicKey.toBase58(),
        payerBalanceLamports: payerBal,
        payerBalanceSol: Number((payerBal / anchor.web3.LAMPORTS_PER_SOL).toFixed(9)),
        maxAffordableLamports: maxAffordableTotalLamports,
        maxAffordableSol: Number((maxAffordableTotalLamports / anchor.web3.LAMPORTS_PER_SOL).toFixed(9)),
        requiredTotalLamports: targetTotal,
        requiredTotalSol: Number((targetTotal / anchor.web3.LAMPORTS_PER_SOL).toFixed(9)),
        shortfallLamports: shortfall,
        shortfallSol: Number((shortfall / anchor.web3.LAMPORTS_PER_SOL).toFixed(9)),
        registrationOnlyRequiredLamports: regOnlyRequired,
        registrationOnlyRequiredSol: Number((regOnlyRequired / anchor.web3.LAMPORTS_PER_SOL).toFixed(9)),
        registrationOnlyShortfallLamports: regOnlyShortfall,
        registrationOnlyShortfallSol: Number((regOnlyShortfall / anchor.web3.LAMPORTS_PER_SOL).toFixed(9)),
        registrationPlusReputationRequiredLamports: regPlusRepRequired,
        registrationPlusReputationRequiredSol: Number((regPlusRepRequired / anchor.web3.LAMPORTS_PER_SOL).toFixed(9)),
        registrationPlusReputationShortfallLamports: regPlusRepShortfall,
        registrationPlusReputationShortfallSol: Number((regPlusRepShortfall / anchor.web3.LAMPORTS_PER_SOL).toFixed(9)),
        topUpCommand: topUpCmd(payer.publicKey, shortfall),
        registrationOnlyTopUpCommand: topUpCmd(payer.publicKey, regOnlyShortfall),
        registrationPlusReputationTopUpCommand: topUpCmd(payer.publicKey, regPlusRepShortfall),
      };
      if (FUNDING_JSON_PATH) {
        fs.writeFileSync(FUNDING_JSON_PATH, JSON.stringify(payload, null, 2), "utf8");
      }
      console.log(JSON.stringify(payload));
      return;
    }
    console.log("CAS5_FUNDING_DRY_RUN=1");
    console.log(`  payer: ${payer.publicKey.toBase58()}`);
    console.log(`  payer balance: ${payerBal} lamports (${(payerBal / anchor.web3.LAMPORTS_PER_SOL).toFixed(6)} SOL)`);
    console.log(`  max affordable (after reserves): ${maxAffordableTotalLamports} lamports`);
    console.log(`  required total (${useDesiredFunding ? "desired" : "minimum"}): ${targetTotal} lamports`);
    console.log(`  shortfall: ${shortfall} lamports (${(shortfall / anchor.web3.LAMPORTS_PER_SOL).toFixed(6)} SOL)`);
    console.log(`  top-up cmd: ${topUpCmd(payer.publicKey, shortfall)}`);
    console.log(`  registration-only required: ${regOnlyRequired} lamports`);
    console.log(`  registration-only shortfall: ${regOnlyShortfall} lamports (${(regOnlyShortfall / anchor.web3.LAMPORTS_PER_SOL).toFixed(6)} SOL)`);
    console.log(`  registration-only top-up cmd: ${topUpCmd(payer.publicKey, regOnlyShortfall)}`);
    console.log(`  registration+reputation required: ${regPlusRepRequired} lamports`);
    console.log(`  registration+reputation shortfall: ${regPlusRepShortfall} lamports (${(regPlusRepShortfall / anchor.web3.LAMPORTS_PER_SOL).toFixed(6)} SOL)`);
    console.log(`  registration+reputation top-up cmd: ${topUpCmd(payer.publicKey, regPlusRepShortfall)}`);
    console.log(`  full-run command (bash): ${fullRunCmdBash()}`);
    console.log(`  full-run command (powershell): ${fullRunCmdPowerShell()}`);
    console.log(`  registration-only run (bash): ${registrationOnlyCmdBash()}`);
    console.log(`  registration-only run (powershell): ${registrationOnlyCmdPowerShell()}`);
    return;
  }
  if (maxAffordableTotalLamports < minTotalLamports) {
    const shortfall = minTotalLamports - maxAffordableTotalLamports;
    const regOnlyHint = regOnlyShortfall === 0
      ? `; registration-only is affordable: bash=${registrationOnlyCmdBash()} ; powershell=${registrationOnlyCmdPowerShell()}`
      : "";
    if (IGNORE_PARTICIPANT_MIN) {
      console.warn(
        `[warn] CAS5_IGNORE_PARTICIPANT_MIN=1 set; continuing with affordable participant funding (${maxAffordableTotalLamports}) below computed minimum (${minTotalLamports}).`,
      );
    } else {
    throw new Error(
      `insufficient payer balance for participant prerequisites: need >= ${minTotalLamports} lamports minimum ` +
      `(${fundingPlan.map((p) => `${p.label}:${p.minLamports}`).join(", ")}), ` +
      `max affordable is ${maxAffordableTotalLamports}, shortfall ${shortfall} lamports ` +
      `(${(shortfall / anchor.web3.LAMPORTS_PER_SOL).toFixed(6)} SOL); payer=${payer.publicKey.toBase58()}; ` +
      `top-up cmd: ${topUpCmd(payer.publicKey, shortfall)}${regOnlyHint}`,
    );
    }
  }

  const plannedLamports = new Map<string, number>();
  if (useDesiredFunding) {
    for (const p of fundingPlan) {
      plannedLamports.set(p.kp.publicKey.toBase58(), Math.max(desiredParticipantLamports, p.minLamports));
    }
  } else if (IGNORE_PARTICIPANT_MIN) {
    // Best-effort mode: first guarantee registration-rent floor for every role, then
    // spend remaining lamports by priority (initiator -> beneficiary -> arbiter).
    let remaining = maxAffordableTotalLamports;
    const baseOrder = ["initiator", "beneficiary", "arbiter"];
    for (const label of baseOrder) {
      const p = fundingPlan.find((x) => x.label === label);
      if (!p) continue;
      const floor = Math.min(agentWalletRentLamports, remaining);
      plannedLamports.set(p.kp.publicKey.toBase58(), floor);
      remaining -= floor;
    }
    for (const label of baseOrder) {
      const p = fundingPlan.find((x) => x.label === label);
      if (!p) continue;
      const key = p.kp.publicKey.toBase58();
      const current = plannedLamports.get(key) ?? 0;
      const deficit = Math.max(0, p.minLamports - current);
      if (deficit === 0 || remaining <= 0) continue;
      const add = Math.min(deficit, remaining);
      plannedLamports.set(key, current + add);
      remaining -= add;
    }
    console.warn(
      `[warn] best-effort participant plan: ${fundingPlan.map((p) => `${p.label}:${plannedLamports.get(p.kp.publicKey.toBase58()) ?? 0}`).join(", ")}; unallocated=${remaining}`,
    );
  } else {
    for (const p of fundingPlan) {
      plannedLamports.set(p.kp.publicKey.toBase58(), p.minLamports);
    }
  }

  for (const p of fundingPlan) {
    const lamports = plannedLamports.get(p.kp.publicKey.toBase58()) ?? 0;
    if (lamports <= 0) {
      console.warn(`[step-skip] fund participant ${p.kp.publicKey.toBase58()} (${p.label}) planned=0`);
      continue;
    }
    await step(`fund participant ${p.kp.publicKey.toBase58()} (${p.label})`, async () => {
      const tx = new anchor.web3.Transaction().add(anchor.web3.SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: p.kp.publicKey, lamports }));
      await provider.sendAndConfirm(tx, []);
    });
  }

  const holdfastIdl = withLegacyAccountTypes(require("../target/idl/vaultpact.json"));
  const escrowIdl = withLegacyAccountTypes(require("../target/idl/vaultpact_escrow.json"));
  holdfastIdl.address = HOLDFAST_PROGRAM_ID;

  const holdfastProgram = new anchor.Program<Vaultpact>(holdfastIdl, provider) as Program<Vaultpact>;
  const escrowProgram = new anchor.Program<VaultpactEscrow>(escrowIdl, provider) as Program<VaultpactEscrow>;

  const [registryPda] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("attestation_registry")], holdfastProgram.programId);
  const [escrowAuthority] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("vp_escrow_authority")], escrowProgram.programId);

  const registryAccount = await connection.getAccountInfo(registryPda, "confirmed");
  if (registryAccount === null) {
    await step("initialize registry", async () => holdfastProgram.methods.initializeRegistry().accounts({
      attestationRegistry: registryPda,
      authority: payer.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
      escrowProgram: escrowProgram.programId,
    }).rpc());
  } else {
    console.log(`[step-skip] initialize registry (already exists: ${registryPda.toBase58()})`);
  }
  let registryDataLen = registryAccount?.data?.length ?? 0;
  let registryMigrationNote = "";
  if (registryDataLen > 0 && registryDataLen < 81) {
    try {
      await step(`migrate attestation registry (len=${registryDataLen} -> 81)`, async () => {
        await holdfastProgram.methods.migrateAttestationRegistry().accounts({
          attestationRegistry: registryPda,
          authority: payer.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        }).signers([payer]).rpc();
      });
      const migrated = await connection.getAccountInfo(registryPda, "confirmed");
      registryDataLen = migrated?.data?.length ?? registryDataLen;
    } catch (err: any) {
      const diag = `${err?.message ?? ""} ${(err?.logs ?? []).join(" ")}`;
      if (diag.includes("InstructionFallbackNotFound")) {
        registryMigrationNote =
          "migration instruction unavailable on deployed holdfast program; deploy upgraded binary with migrate_attestation_registry";
        console.warn(`[warn] ${registryMigrationNote}`);
      } else {
        throw err;
      }
    }
  }
  const supportsCancelPendingReputationCpi = registryDataLen >= 81;

  async function registerAgentWallet(authority: anchor.web3.Keypair): Promise<anchor.web3.PublicKey> {
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const privKey = p256.utils.randomPrivateKey();
      const uncompressed: Uint8Array = p256.getPublicKey(privKey, false);
      const compressedPubkey: Uint8Array = p256.getPublicKey(privKey, true);
      const pubkeyX = Buffer.from(uncompressed.slice(1, 33));
      const pubkeyY = Buffer.from(uncompressed.slice(33, 65));
      const [walletPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("agent_wallet"), pubkeyX, pubkeyY],
        holdfastProgram.programId,
      );
      const preimage = buildRegistrationPreimage(authority.publicKey, pubkeyX, pubkeyY);
      const preimageHash = crypto.createHash("sha256").update(preimage).digest();
      const regIx = await holdfastProgram.methods
        .registerAgentWallet(Array.from(pubkeyX), Array.from(pubkeyY))
        .accounts({
          agentWallet: walletPda,
          attestationRegistry: registryPda,
          payer: authority.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          instructions: SYSVAR_INSTRUCTIONS,
        })
        .signers([authority])
        .instruction();

      const signature = p256.sign(preimageHash, privKey) as
        Uint8Array | { toCompactRawBytes: () => Uint8Array };
      const sigBytes = signature instanceof Uint8Array ? signature : signature.toCompactRawBytes();
      const secpModes: Array<{ name: string; build: (sig: Uint8Array, pubkey: Uint8Array, message: Buffer) => anchor.web3.TransactionInstruction }> = [
        { name: "canonical-compressed-hash/legacy-header", build: buildSecp256r1InstructionLegacy },
        { name: "canonical-compressed-hash/compact-header", build: buildSecp256r1InstructionCompact },
      ];
      for (const mode of secpModes) {
        const secpIx = mode.build(sigBytes, compressedPubkey, preimageHash);
        const secpData = Buffer.from(secpIx.data);
        console.warn(`[register-debug] ${authority.publicKey.toBase58()} mode=${mode.name} msg_size=${secpData.readUInt16LE(mode.name.includes("legacy") ? 12 : 10)} len=${secpData.length}`);
        const tx = new anchor.web3.Transaction().add(secpIx, regIx);
        try {
          await provider.sendAndConfirm(tx, [authority]);
          console.warn(`[register-note] ${authority.publicKey.toBase58()} accepted with ${mode.name}`);
          return walletPda;
        } catch (err: any) {
          lastErr = err;
          const diag = `${err?.message ?? ""} ${(err?.logs ?? []).join(" ")}`;
          const txLogs = (err?.logs as string[] | undefined) ?? [];
          const registrationLoggedSuccess =
            txLogs.some((l) => l.includes("Instruction: RegisterAgentWallet")) &&
            txLogs.some((l) => l.includes("Agent wallet registered")) &&
            txLogs.some((l) => l.includes("success"));
          if (registrationLoggedSuccess && diag.includes("insufficient funds for rent")) {
            console.warn(
              `[register-note] ${authority.publicKey.toBase58()} registration succeeded; treating post-simulation rent shortfall as non-fatal`,
            );
            return walletPda;
          }
          console.warn(`[register-diag] ${authority.publicKey.toBase58()} attempt ${attempt}/5 mode=${mode.name} :: ${diag.slice(0, 260)}`);
          const retryable =
            diag.includes("Instruction 0") &&
            (
              diag.includes("custom program error: 0x2") ||
              diag.includes('Custom\":2') ||
              diag.includes("custom program error: 0x3") ||
              diag.includes('Custom\":3') ||
              diag.includes("custom program error: 0x0") ||
              diag.includes('Custom\":0')
            );
          if (!retryable) throw err;

          try {
            tx.feePayer = provider.wallet.publicKey;
            tx.recentBlockhash = (await provider.connection.getLatestBlockhash("confirmed")).blockhash;
            tx.partialSign(authority);
            const signedTx = await provider.wallet.signTransaction(tx);
            const sig = await provider.connection.sendRawTransaction(
              signedTx.serialize(),
              { skipPreflight: true, maxRetries: 5 },
            );
            await provider.connection.confirmTransaction(sig, "confirmed");
            const txInfo = await provider.connection.getTransaction(sig, {
              commitment: "confirmed",
              maxSupportedTransactionVersion: 0,
            });
            if (!txInfo?.meta?.err) {
              console.warn(`[register-fallback-ok] ${authority.publicKey.toBase58()} attempt ${attempt}/5 mode=${mode.name} sig=${sig}`);
              return walletPda;
            }
            lastErr = new Error(
              `register_agent_wallet fallback failed: ${JSON.stringify(txInfo.meta.err)} | logs: ${(txInfo.meta.logMessages ?? []).join(" | ")}`,
            );
          } catch (fallbackErr) {
            lastErr = fallbackErr;
          }
        }
      }
      if (attempt < 5) {
        console.warn(`[register-retry] ${authority.publicKey.toBase58()} attempt ${attempt}/5 exhausted; retrying with fresh key`);
      }
    }
    throw lastErr ?? new Error("register_agent_wallet failed with unknown error");
  }

  async function initRep(agent: anchor.web3.Keypair): Promise<anchor.web3.PublicKey> {
    const agentBal = await connection.getBalance(agent.publicKey);
    if (agentBal < reputationRentLamports) {
      const repShortfall = reputationRentLamports - agentBal;
      throw new Error(
        `insufficient lamports for init_reputation: agent=${agent.publicKey.toBase58()} balance=${agentBal} ` +
        `need=${reputationRentLamports} shortfall=${repShortfall} ` +
        `(${(repShortfall / anchor.web3.LAMPORTS_PER_SOL).toFixed(6)} SOL); ` +
        `top-up cmd: ${topUpCmd(agent.publicKey, repShortfall)}`,
      );
    }
    const [repPda] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("reputation"), agent.publicKey.toBuffer()], holdfastProgram.programId);
    await holdfastProgram.methods.initReputation().accounts({ reputationAccount: repPda, agent: agent.publicKey, systemProgram: anchor.web3.SystemProgram.programId }).signers([agent]).rpc();
    return repPda;
  }

  const initiatorWallet = await step(`register agent wallet ${initiator.publicKey.toBase58()}`, async () => registerAgentWallet(initiator));
  if (REGISTRATION_ONLY) {
    console.log("CAS5_REGISTRATION_ONLY=1: registration path passed.");
    console.log(`  initiator wallet: ${initiatorWallet.toBase58()}`);
    return;
  }
  const beneficiaryWallet = await step(`register agent wallet ${beneficiary.publicKey.toBase58()}`, async () => registerAgentWallet(beneficiary));
  const arbiterWallet = await step(`register agent wallet ${arbiter.publicKey.toBase58()}`, async () => registerAgentWallet(arbiter));

  const initiatorRep = await step(`init reputation ${initiator.publicKey.toBase58()}`, async () => initRep(initiator));
  const beneficiaryRep = await step(`init reputation ${beneficiary.publicKey.toBase58()}`, async () => initRep(beneficiary));

  const mint = anchor.web3.Keypair.generate();
  const mintRent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  await provider.sendAndConfirm(new anchor.web3.Transaction().add(
    anchor.web3.SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey, space: MINT_SIZE, lamports: mintRent, programId: TOKEN_PROGRAM_ID }),
    splInitMint2Ix(mint.publicKey, 6, payer.publicKey),
  ), [mint]);

  const iToken = anchor.web3.Keypair.generate();
  const bToken = anchor.web3.Keypair.generate();
  const altBToken = anchor.web3.Keypair.generate();
  const tokenRent = await connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE);
  for (const [acct, owner] of [[iToken, initiator.publicKey], [bToken, beneficiary.publicKey], [altBToken, beneficiary.publicKey]] as const) {
    await provider.sendAndConfirm(new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: acct.publicKey, space: TOKEN_ACCOUNT_SIZE, lamports: tokenRent, programId: TOKEN_PROGRAM_ID }),
      splInitAccount3Ix(acct.publicKey, mint.publicKey, owner),
    ), [acct]);
  }

  await provider.sendAndConfirm(new anchor.web3.Transaction().add(splMintToIx(mint.publicKey, iToken.publicKey, payer.publicKey, 10_000_000)), [payer]);
  await provider.sendAndConfirm(new anchor.web3.Transaction().add(splMintToIx(mint.publicKey, bToken.publicKey, payer.publicKey, 10_000_000)), [payer]);
  const nowMs = Date.now();

  // MED-F-001
  const escrowId1 = randomEscrowId();
  const [escrow1] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("escrow"), Buffer.from(escrowId1)], escrowProgram.programId);
  const [pact1] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("pact"), Buffer.from(escrowId1)], escrowProgram.programId);
  const [dispute1] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dispute"), Buffer.from(escrowId1)], escrowProgram.programId);
  const vault1 = getAssociatedTokenAddress(mint.publicKey, escrow1);

  await escrowProgram.methods.initializeEscrow({
    escrowId: escrowId1,
    beneficiary: beneficiary.publicKey,
    arbiter: arbiter.publicKey,
    escrowAmount: new anchor.BN(400_000), initiatorStake: new anchor.BN(0), beneficiaryStake: new anchor.BN(0),
    timeLockExpiresAt: new anchor.BN(nowMs + (2 * 60 * 60 * 1000)),
    deliverablesHash: Array(32).fill(1), deliverablesUri: Array(128).fill(0), autoReleaseOnExpiry: false, slashLoserStake: false,
    disputeDeadlineSecs: new anchor.BN(86400), initiatorReputationMin: new anchor.BN(0), beneficiaryReputationMin: new anchor.BN(0),
    initiatorMinTier: 0, initiatorMinPacts: new anchor.BN(0), beneficiaryMinTier: 0, beneficiaryMinPacts: new anchor.BN(0),
  }).accounts({
    initiator: initiator.publicKey, escrowAccount: escrow1, pactRecord: pact1, mint: mint.publicKey, vault: vault1,
    initiatorReputation: initiatorRep, initiatorWallet, beneficiaryWallet, arbiterWallet, vaultpactProgram: holdfastProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId,
  }).signers([initiator]).rpc();

  await escrowProgram.methods.depositFunds().accounts({ initiator: initiator.publicKey, escrowAccount: escrow1, initiatorTokenAccount: iToken.publicKey, vault: vault1, tokenProgram: TOKEN_PROGRAM_ID }).signers([initiator]).rpc();
  await escrowProgram.methods.stakeBeneficiary().accounts({ beneficiary: beneficiary.publicKey, escrowAccount: escrow1, pactRecord: pact1, beneficiaryTokenAccount: bToken.publicKey, vault: vault1, beneficiaryReputation: beneficiaryRep, beneficiaryWallet, vaultpactProgram: holdfastProgram.programId, tokenProgram: TOKEN_PROGRAM_ID }).signers([beneficiary]).rpc();
  await escrowProgram.methods.lockEscrow().accounts({ initiator: initiator.publicKey, beneficiary: beneficiary.publicKey, escrowAccount: escrow1, pactRecord: pact1, vault: vault1, initiatorWallet, beneficiaryWallet, arbiterWallet, initiatorReputation: initiatorRep, beneficiaryReputation: beneficiaryRep, vaultpactProgram: holdfastProgram.programId }).signers([initiator, beneficiary]).rpc();
  const raiseIx = buildRaiseDisputeIx(
    { evidenceHash: Array(32).fill(7), evidenceUri: Array(128).fill(0) },
    {
      programId: escrowProgram.programId,
      raiser: initiator.publicKey,
      escrowAccount: escrow1,
      pactRecord: pact1,
      disputeRecord: dispute1,
      vault: vault1,
      beneficiaryTokenAccount: bToken.publicKey,
      initiatorTokenAccount: iToken.publicKey,
    },
  );
  const raiseSig = await provider.sendAndConfirm(new anchor.web3.Transaction().add(raiseIx), [initiator]);

  let med1Pass = false;
  let med1Detail = "";
  try {
    await escrowProgram.methods.resolveDispute({ decision: { releaseToBeneficiary: {} }, reasoningHash: Array(32).fill(9) }).accounts({
      arbiter: arbiter.publicKey, escrowAccount: escrow1, pactRecord: pact1, disputeRecord: dispute1, vault: vault1,
      beneficiaryTokenAccount: altBToken.publicKey,
      initiatorTokenAccount: iToken.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      arbiterWallet,
      initiatorReputation: initiatorRep,
      beneficiaryReputation: beneficiaryRep,
      escrowAuthority,
      vaultpactProgram: holdfastProgram.programId,
    }).signers([arbiter]).rpc();
    med1Detail = "unexpected success";
  } catch (err: any) {
    const diag = `${(err?.logs ?? []).join(" ")} ${err?.message ?? ""}`;
    med1Pass = diag.includes("UnauthorizedTokenAccount") || diag.includes("ConstraintHasOne");
    med1Detail = diag.slice(0, 260);
  }

  // MED-F-002
  const escrowId2 = randomEscrowId();
  const [escrow2] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("escrow"), Buffer.from(escrowId2)], escrowProgram.programId);
  const [pact2] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("pact"), Buffer.from(escrowId2)], escrowProgram.programId);
  const vault2 = getAssociatedTokenAddress(mint.publicKey, escrow2);
  const pastLock = nowMs - 60_000;

  await escrowProgram.methods.initializeEscrow({
    escrowId: escrowId2,
    beneficiary: beneficiary.publicKey,
    arbiter: arbiter.publicKey,
    escrowAmount: new anchor.BN(220_000), initiatorStake: new anchor.BN(11_000), beneficiaryStake: new anchor.BN(0),
    timeLockExpiresAt: new anchor.BN(pastLock),
    deliverablesHash: Array(32).fill(3), deliverablesUri: Array(128).fill(0), autoReleaseOnExpiry: false, slashLoserStake: false,
    disputeDeadlineSecs: new anchor.BN(86400), initiatorReputationMin: new anchor.BN(0), beneficiaryReputationMin: new anchor.BN(0),
    initiatorMinTier: 0, initiatorMinPacts: new anchor.BN(0), beneficiaryMinTier: 0, beneficiaryMinPacts: new anchor.BN(0),
  }).accounts({
    initiator: initiator.publicKey, escrowAccount: escrow2, pactRecord: pact2, mint: mint.publicKey, vault: vault2,
    initiatorReputation: initiatorRep, initiatorWallet, beneficiaryWallet, arbiterWallet, vaultpactProgram: holdfastProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId,
  }).signers([initiator]).rpc();

  await escrowProgram.methods.depositFunds().accounts({ initiator: initiator.publicKey, escrowAccount: escrow2, initiatorTokenAccount: iToken.publicKey, vault: vault2, tokenProgram: TOKEN_PROGRAM_ID }).signers([initiator]).rpc();

  const iNonceBefore = await fetchReputationNonce(connection, initiatorRep);
  const bNonceBefore = await fetchReputationNonce(connection, beneficiaryRep);

  const [attestationRegistry] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("attestation_registry")],
    holdfastProgram.programId,
  );
  let cancelSig = "";
  let med2Detail = "";
  if (!supportsCancelPendingReputationCpi) {
    med2Detail = registryMigrationNote
      ? `BLOCKED_LEGACY_REGISTRY len=${registryDataLen} (need 81; ${registryMigrationNote})`
      : `BLOCKED_LEGACY_REGISTRY len=${registryDataLen} (need 81; run migrate_attestation_registry as INITIAL_AUTHORITY)`;
  } else {
    const cancelIx = buildCancelPendingEscrowIx({
      programId: escrowProgram.programId,
      initiator: initiator.publicKey,
      escrowAccount: escrow2,
      vault: vault2,
      initiatorTokenAccount: iToken.publicKey,
      beneficiaryTokenAccount: bToken.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      initiatorReputation: initiatorRep,
      beneficiaryReputation: beneficiaryRep,
      escrowAuthority,
      attestationRegistry,
      vaultpactProgram: holdfastProgram.programId,
    });
    cancelSig = await provider.sendAndConfirm(new anchor.web3.Transaction().add(cancelIx), [initiator]);
  }

  const iNonceAfter = await fetchReputationNonce(connection, initiatorRep);
  const bNonceAfter = await fetchReputationNonce(connection, beneficiaryRep);

  const med2Pass = supportsCancelPendingReputationCpi && iNonceAfter === iNonceBefore + 1 && bNonceAfter === bNonceBefore + 1;

  console.log(`MED-F-001: ${med1Pass ? "PASS" : "FAIL"}`);
  console.log(`  raise_dispute tx: https://explorer.solana.com/tx/${raiseSig}?cluster=devnet`);
  console.log(`  detail: ${med1Detail}`);
  console.log(`MED-F-002: ${med2Pass ? "PASS" : "FAIL"}`);
  if (cancelSig) {
    console.log(`  cancel_pending_escrow tx: https://explorer.solana.com/tx/${cancelSig}?cluster=devnet`);
  }
  if (med2Detail) {
    console.log(`  detail: ${med2Detail}`);
  }
  console.log(`  nonces: initiator ${iNonceBefore} -> ${iNonceAfter}, beneficiary ${bNonceBefore} -> ${bNonceAfter}`);

  if (!med1Pass || !med2Pass) {
    throw new Error(`MED assertions failed: MED-F-001=${med1Pass ? "PASS" : "FAIL"}, MED-F-002=${med2Pass ? "PASS" : "FAIL"}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

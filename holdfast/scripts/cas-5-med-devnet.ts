import * as anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
import type { VaultpactEscrow } from "../target/types/vaultpact_escrow";
import type { Vaultpact } from "../target/types/vaultpact";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { p256 } = require("../oracle/node_modules/@noble/curves/nist.js");

const RPC_URL = process.env["ANCHOR_PROVIDER_URL"] ?? "https://api.devnet.solana.com";
const PAYER_KEYPAIR_PATH = process.env["PAYER_KEYPAIR_PATH"] ?? "~/.config/solana/devnet.json";
const TOKEN_PROGRAM_ID = new anchor.web3.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new anchor.web3.PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSVAR_INSTRUCTIONS = new anchor.web3.PublicKey("Sysvar1nstructions1111111111111111111111111");
const SECP256R1_PROGRAM_ID = new anchor.web3.PublicKey(Buffer.from([6,146,13,236,47,234,113,181,183,35,129,77,116,45,169,3,28,131,231,95,219,121,93,86,142,117,71,128,32,0,0,0]));
const MINT_SIZE = 82;
const TOKEN_ACCOUNT_SIZE = 165;

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

function buildSecp256r1Instruction(sig: Uint8Array, pubkey: Uint8Array, message: Buffer): anchor.web3.TransactionInstruction {
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

function buildRegistrationPreimage(authority: anchor.web3.PublicKey, pubkeyX: Buffer, pubkeyY: Buffer): Buffer {
  return Buffer.concat([Buffer.from("vaultpact:register_agent_wallet:v1:"), authority.toBuffer(), pubkeyX, pubkeyY]);
}

function randomEscrowId(): number[] { return Array.from(crypto.randomBytes(32)); }

async function main(): Promise<void> {
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
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), { commitment: "confirmed" });
  anchor.setProvider(provider);

  const holdfastIdl = require("../target/idl/vaultpact.json");
  const escrowIdl = require("../target/idl/vaultpact_escrow.json");

  const holdfastProgram = new anchor.Program<Vaultpact>(holdfastIdl, provider) as Program<Vaultpact>;
  const escrowProgram = new anchor.Program<VaultpactEscrow>(escrowIdl, provider) as Program<VaultpactEscrow>;

  const [registryPda] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("attestation_registry")], holdfastProgram.programId);
  const [escrowAuthority] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("vp_escrow_authority")], escrowProgram.programId);

  const payerBal = await connection.getBalance(payer.publicKey);
  if (payerBal < 0.25 * anchor.web3.LAMPORTS_PER_SOL) throw new Error(`insufficient payer balance: ${payerBal}`);

  const initiator = anchor.web3.Keypair.generate();
  const beneficiary = anchor.web3.Keypair.generate();
  const arbiter = anchor.web3.Keypair.generate();

  for (const kp of [initiator, beneficiary, arbiter]) {
    await step(`fund participant ${kp.publicKey.toBase58()}`, async () => {
      const tx = new anchor.web3.Transaction().add(anchor.web3.SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: kp.publicKey, lamports: 0.03 * anchor.web3.LAMPORTS_PER_SOL }));
      await provider.sendAndConfirm(tx, []);
    });
  }

  try {
    await step("initialize registry", async () => holdfastProgram.methods.initializeRegistry().accounts({
      attestationRegistry: registryPda,
      authority: payer.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
      escrowProgram: escrowProgram.programId,
    }).rpc());
  } catch (e: any) {
    const msg = String(e?.message ?? "");
    const logs = Array.isArray(e?.logs) ? e.logs.join(" | ") : "";
    const diag = `${msg} ${logs}`;
    if (!diag.includes("already in use")) throw e;
  }

  async function registerAgentWallet(authority: anchor.web3.Keypair): Promise<anchor.web3.PublicKey> {
    const privKey = p256.utils.randomPrivateKey();
    const uncompressed: Uint8Array = p256.getPublicKey(privKey, false);
    const pubkeyX = Buffer.from(uncompressed.slice(1, 33));
    const pubkeyY = Buffer.from(uncompressed.slice(33, 65));
    const [walletPda] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("agent_wallet"), pubkeyX, pubkeyY], holdfastProgram.programId);
    const preimage = buildRegistrationPreimage(authority.publicKey, pubkeyX, pubkeyY);
    const preimageHash = crypto.createHash("sha256").update(preimage).digest();
    const sigBytes = p256.sign(preimageHash, privKey).toCompactRawBytes();
    const secpIx = buildSecp256r1Instruction(sigBytes, uncompressed, preimage);
    const regIx = await holdfastProgram.methods.registerAgentWallet(Array.from(pubkeyX), Array.from(pubkeyY)).accounts({
      agentWallet: walletPda,
      attestationRegistry: registryPda,
      payer: authority.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
      instructions: SYSVAR_INSTRUCTIONS,
    }).signers([authority]).instruction();
    const tx = new anchor.web3.Transaction().add(secpIx, regIx);
    try {
      await provider.sendAndConfirm(tx, [authority]);
    } catch (err: any) {
      const diag = `${err?.message ?? ""} ${(err?.logs ?? []).join(" ")}`;
      const isKnownSimBoundary =
        diag.includes("Instruction 0") &&
        (diag.includes("custom program error: 0x2") ||
          diag.includes('Custom":2'));
      if (!isKnownSimBoundary) throw err;

      tx.feePayer = provider.wallet.publicKey;
      tx.recentBlockhash = (
        await provider.connection.getLatestBlockhash("confirmed")
      ).blockhash;
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
      if (txInfo?.meta?.err) {
        const txLogs = txInfo.meta.logMessages ?? [];
        throw new Error(
          `register_agent_wallet failed after skipPreflight fallback: ${JSON.stringify(txInfo.meta.err)} | logs: ${txLogs.join(" | ")}`,
        );
      }
    }
    return walletPda;
  }

  async function initRep(agent: anchor.web3.Keypair): Promise<anchor.web3.PublicKey> {
    const [repPda] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("reputation"), agent.publicKey.toBuffer()], holdfastProgram.programId);
    await holdfastProgram.methods.initReputation().accounts({ reputationAccount: repPda, agent: agent.publicKey, systemProgram: anchor.web3.SystemProgram.programId }).signers([agent]).rpc();
    return repPda;
  }

  const initiatorWallet = await step(`register agent wallet ${initiator.publicKey.toBase58()}`, async () => registerAgentWallet(initiator));
  const beneficiaryWallet = await step(`register agent wallet ${beneficiary.publicKey.toBase58()}`, async () => registerAgentWallet(beneficiary));
  const arbiterWallet = await step(`register agent wallet ${arbiter.publicKey.toBase58()}`, async () => registerAgentWallet(arbiter));

  const initiatorRep = await initRep(initiator);
  const beneficiaryRep = await initRep(beneficiary);

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
    timeLockExpiresAt: new anchor.BN(Math.floor(Date.now() / 1000) + 3600),
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
  const raiseSig = await escrowProgram.methods.raiseDispute({ evidenceHash: Array(32).fill(7), evidenceUri: Array(128).fill(0) }).accounts({ raiser: initiator.publicKey, escrowAccount: escrow1, pactRecord: pact1, disputeRecord: dispute1, systemProgram: anchor.web3.SystemProgram.programId }).signers([initiator]).rpc();

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
  const pastLock = Math.floor(Date.now() / 1000) - 60;

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

  const repIBefore = await holdfastProgram.account.reputationAccount.fetch(initiatorRep);
  const repBBefore = await holdfastProgram.account.reputationAccount.fetch(beneficiaryRep);
  const iNonceBefore = (repIBefore.nonce as anchor.BN).toNumber();
  const bNonceBefore = (repBBefore.nonce as anchor.BN).toNumber();

  const cancelSig = await escrowProgram.methods.cancelPendingEscrow().accounts({
    initiator: initiator.publicKey,
    escrowAccount: escrow2,
    vault: vault2,
    initiatorTokenAccount: iToken.publicKey,
    beneficiaryTokenAccount: bToken.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
    initiatorReputation: initiatorRep,
    beneficiaryReputation: beneficiaryRep,
    escrowAuthority,
    vaultpactProgram: holdfastProgram.programId,
  }).signers([initiator]).rpc();

  const repIAfter = await holdfastProgram.account.reputationAccount.fetch(initiatorRep);
  const repBAfter = await holdfastProgram.account.reputationAccount.fetch(beneficiaryRep);
  const iNonceAfter = (repIAfter.nonce as anchor.BN).toNumber();
  const bNonceAfter = (repBAfter.nonce as anchor.BN).toNumber();

  const med2Pass = iNonceAfter === iNonceBefore + 1 && bNonceAfter === bNonceBefore + 1;

  console.log(`MED-F-001: ${med1Pass ? "PASS" : "FAIL"}`);
  console.log(`  raise_dispute tx: https://explorer.solana.com/tx/${raiseSig}?cluster=devnet`);
  console.log(`  detail: ${med1Detail}`);
  console.log(`MED-F-002: ${med2Pass ? "PASS" : "FAIL"}`);
  console.log(`  cancel_pending_escrow tx: https://explorer.solana.com/tx/${cancelSig}?cluster=devnet`);
  console.log(`  nonces: initiator ${iNonceBefore} -> ${iNonceAfter}, beneficiary ${bNonceBefore} -> ${bNonceAfter}`);

  if (!med1Pass || !med2Pass) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

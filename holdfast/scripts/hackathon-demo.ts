/**
 * Holdfast Protocol — Colosseum Frontier Hackathon Demo
 *
 * Flow: agent wallet registration → reputation update → indexer query
 * Network: Solana devnet only.
 *
 * DEVNET DEMONSTRATION ONLY
 * Holdfast programs have not been formally audited.
 * Not for production use. No security guarantees.
 * (Approved disclaimer — CAS-57#document-disclaimer)
 *
 * Prerequisites:
 *   - ~/.config/solana/devnet.json  (funded payer keypair, ≥ 0.1 SOL)
 *   - ~/.config/solana/oracle-devnet.json  (oracle authority keypair)
 *   - Holdfast indexer running at INDEXER_URL (or set INDEXER_URL env var)
 *   - Holdfast programs deployed to devnet at D6mUa4wGtFyLyJorMfxoKvA9ybohjUSsfw88t66ATxg
 *
 * Run:
 *   yarn demo
 */

import * as anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
import type { Vaultpact } from "../target/types/vaultpact";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// P-256 (secp256r1) — reuses the copy already in oracle/node_modules.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { p256 } = require("../oracle/node_modules/@noble/curves/nist.js");

// ── Config ────────────────────────────────────────────────────────────────────

const RPC_URL = process.env["ANCHOR_PROVIDER_URL"] ?? "https://api.devnet.solana.com";
const INDEXER_URL = process.env["INDEXER_URL"] ?? "https://holdfast-indexer.fly.dev";
const PROGRAM_ID = new anchor.web3.PublicKey("D6mUa4wGtFyLyJorMfxoKvA9ybohjUSsfw88t66ATxg");

const SECP256R1_PROGRAM_ID = new anchor.web3.PublicKey(
  Buffer.from([
    6, 146, 13, 236, 47, 234, 113, 181, 183, 35, 129, 77, 116, 45, 169, 3,
    28, 131, 231, 95, 219, 121, 93, 86, 142, 117, 71, 128, 32, 0, 0, 0,
  ]),
);

const SYSVAR_INSTRUCTIONS = new anchor.web3.PublicKey(
  "Sysvar1nstructions1111111111111111111111111",
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadKeypair(filePath: string): anchor.web3.Keypair {
  const resolved = filePath.replace(/^~/, os.homedir());
  const raw = JSON.parse(fs.readFileSync(resolved, "utf8")) as number[];
  return anchor.web3.Keypair.fromSecretKey(Uint8Array.from(raw));
}

function explorerTx(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

function explorerAddr(pubkey: string): string {
  return `https://explorer.solana.com/address/${pubkey}?cluster=devnet`;
}

function hr(char = "═", width = 66): string {
  return char.repeat(width);
}

function fmt(label: string, value: string, width = 22): string {
  return `  ${label.padEnd(width)} ${value}`;
}

function outcomeLabel(o: number): string {
  return o === 0 ? "Fulfilled" : o === 1 ? "Disputed" : "Cancelled";
}

function tierLabel(t: unknown): string {
  // Anchor 0.31 returns enum variants as objects: { unverified: {} }
  if (typeof t === "object" && t !== null) {
    const key = Object.keys(t as object)[0] ?? "";
    return key.charAt(0).toUpperCase() + key.slice(1);
  }
  return (["Unverified", "Attested", "Verified"] as string[])[t as number] ?? `tier(${t})`;
}

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

// ── Main demo ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n" + hr());
  console.log("  Holdfast Protocol · Colosseum Frontier Hackathon Demo");
  console.log(hr());
  console.log("  DEVNET DEMONSTRATION ONLY");
  console.log("  Holdfast programs have not been formally audited.");
  console.log("  Not for production use. No security guarantees.");
  console.log(hr());

  // ── [1/5] Setup ──────────────────────────────────────────────────────────

  console.log("\n[1/5] Setting up identities...");

  const payerKeypair = loadKeypair("~/.config/solana/devnet.json");
  const oracleKeypair = loadKeypair("~/.config/solana/oracle-devnet.json");

  const connection = new anchor.web3.Connection(RPC_URL, "confirmed");
  const wallet = new anchor.Wallet(payerKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });

  // Load IDL from compiled target
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const IDL = require("../target/idl/vaultpact.json");
  const program = new anchor.Program<Vaultpact>(IDL, provider) as Program<Vaultpact>;

  const payerBalance = await connection.getBalance(payerKeypair.publicKey);
  const oracleBalance = await connection.getBalance(oracleKeypair.publicKey);

  console.log(fmt("Payer:", `${payerKeypair.publicKey.toBase58()}  (${(payerBalance / anchor.web3.LAMPORTS_PER_SOL).toFixed(4)} SOL)`));
  console.log(fmt("Oracle:", `${oracleKeypair.publicKey.toBase58()}  (${(oracleBalance / anchor.web3.LAMPORTS_PER_SOL).toFixed(4)} SOL)`));
  console.log(fmt("RPC:", RPC_URL));
  console.log(fmt("Indexer:", INDEXER_URL));

  if (payerBalance < 0.05 * anchor.web3.LAMPORTS_PER_SOL) {
    console.log("  ⚡ Payer low balance — requesting airdrop...");
    const sig = await connection.requestAirdrop(payerKeypair.publicKey, anchor.web3.LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
    console.log("  ✓ Airdrop confirmed");
  }
  if (oracleBalance < 0.01 * anchor.web3.LAMPORTS_PER_SOL) {
    // Fund oracle from payer — avoids devnet faucet rate-limit on 0-balance accounts.
    console.log("  ⚡ Oracle low balance — funding from payer...");
    const fundTx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: payerKeypair.publicKey,
        toPubkey: oracleKeypair.publicKey,
        lamports: 0.05 * anchor.web3.LAMPORTS_PER_SOL,
      }),
    );
    const fundSig = await provider.sendAndConfirm(fundTx, []);
    console.log(fmt("  ✓ Funded oracle:", explorerTx(fundSig)));
  }

  // ── [2/5] Register agent wallet ──────────────────────────────────────────

  console.log("\n[2/5] Registering agent wallet (secp256r1 / WebAuthn key)...");

  const privKey = p256.utils.randomPrivateKey() as Uint8Array;
  const uncompressed = p256.getPublicKey(privKey, false) as Uint8Array;
  const compressedPubkey = p256.getPublicKey(privKey, true) as Uint8Array;
  const pubkeyX = Buffer.from(uncompressed.slice(1, 33));
  const pubkeyY = Buffer.from(uncompressed.slice(33, 65));

  const [walletPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("agent_wallet"), pubkeyX, pubkeyY],
    PROGRAM_ID,
  );

  const [registryPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("attestation_registry")],
    PROGRAM_ID,
  );

  console.log(fmt("P-256 key x:", pubkeyX.toString("hex").slice(0, 32) + "..."));
  console.log(fmt("P-256 key y:", pubkeyY.toString("hex").slice(0, 32) + "..."));
  console.log(fmt("Agent wallet PDA:", walletPda.toBase58()));

  const walletExists = await connection.getAccountInfo(walletPda);
  if (walletExists !== null) {
    console.log("  ✓ Agent wallet already registered (skipping)");
  } else {
    const preimage = buildRegistrationPreimage(payerKeypair.publicKey, pubkeyX, pubkeyY);
    const preimageHash = crypto.createHash("sha256").update(preimage).digest();
    const sigBytes = p256.sign(preimageHash, privKey).toCompactRawBytes() as Uint8Array;

    const secp256r1Ix = buildSecp256r1Instruction(sigBytes, compressedPubkey, preimageHash);
    const registerIx = await program.methods
      .registerAgentWallet(Array.from(pubkeyX) as number[], Array.from(pubkeyY) as number[])
      .accounts({
        agentWallet: walletPda,
        attestationRegistry: registryPda,
        payer: payerKeypair.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        instructions: SYSVAR_INSTRUCTIONS,
      })
      .instruction();

    try {
      const tx = new anchor.web3.Transaction().add(secp256r1Ix, registerIx);
      const sig = await provider.sendAndConfirm(tx, []);
      console.log(fmt("  ✓ Tx:", explorerTx(sig)));
    } catch (err: unknown) {
      // The secp256r1 precompile (SIMD-48) requires devnet feature activation.
      // Full registration flow is verified on localnet; devnet support follows cluster upgrade.
      const msg = err instanceof Error ? err.message.slice(0, 80) : String(err);
      console.log(`  ⚠ Registration tx failed on devnet (${msg})`);
      console.log("  → On-chain wallet PDA derived and shown above.");
      console.log("  → Reputation and indexer flows continue independently.");
    }
  }

  // ── [3/5] Initialize reputation account ──────────────────────────────────

  console.log("\n[3/5] Initializing reputation account for agent...");

  // Agent = payer ed25519 keypair (separate concern from the secp256r1 wallet key)
  const agentKeypair = payerKeypair;

  const [repPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("reputation"), agentKeypair.publicKey.toBuffer()],
    PROGRAM_ID,
  );

  console.log(fmt("Agent pubkey:", agentKeypair.publicKey.toBase58()));
  console.log(fmt("Reputation PDA:", repPda.toBase58()));
  console.log(fmt("Explorer:", explorerAddr(repPda.toBase58())));

  const repExists = await connection.getAccountInfo(repPda);
  if (repExists !== null) {
    console.log("  ✓ Reputation account already exists (skipping init)");
  } else {
    const sig = await program.methods
      .initReputation()
      .accounts({
        reputationAccount: repPda,
        agent: agentKeypair.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([agentKeypair])
      .rpc();
    console.log(fmt("  ✓ Tx:", explorerTx(sig)));
    console.log(fmt("  Initial score:", "5000 / 10000 bp  (neutral)"));
  }

  // ── [4/5] Oracle reputation update ───────────────────────────────────────

  console.log("\n[4/5] Simulating completed pact (oracle reputation update)...");

  // Read current nonce to build the correct next nonce
  const repBefore = await program.account.reputationAccount.fetch(repPda);
  const currentNonce = (repBefore.nonce as anchor.BN).toNumber();
  const nextNonce = currentNonce + 1;
  const pactId = Array.from(crypto.randomBytes(7)) as number[];

  console.log(fmt("Pact outcome:", "Fulfilled  (+200 basis points)"));
  console.log(fmt("Nonce:", String(nextNonce)));
  console.log(fmt("Pact ID:", Buffer.from(pactId).toString("hex")));

  const updateSig = await program.methods
    .updateReputation(
      new anchor.BN(nextNonce),
      { fulfilled: {} },
      200,
      pactId,
    )
    .accounts({
      reputationAccount: repPda,
      updateAuthority: oracleKeypair.publicKey,
    })
    .signers([oracleKeypair])
    .rpc();

  console.log(fmt("  ✓ Tx:", explorerTx(updateSig)));

  const repAfter = await program.account.reputationAccount.fetch(repPda);
  const score = (repAfter.score as anchor.BN).toNumber();
  const totalPacts = (repAfter.totalPacts as anchor.BN).toNumber();
  const disputeCount = (repAfter.disputeCount as anchor.BN).toNumber();
  const tier = repAfter.tier;

  console.log("\n  On-chain reputation:");
  console.log("  " + hr("─", 50));
  console.log(fmt("  Score:", `${score} / 10000 bp  (${(score / 100).toFixed(2)}%)`));
  console.log(fmt("  Tier:", tierLabel(tier)));
  console.log(fmt("  Total pacts:", String(totalPacts)));
  console.log(fmt("  Disputes:", String(disputeCount)));
  console.log(fmt("  History entries:", String(repAfter.historyLen)));
  console.log("  " + hr("─", 50));

  // ── [5/5] Indexer attestation query ──────────────────────────────────────

  console.log("\n[5/5] Querying attestation history via indexer...");
  // Brief pause so the WebSocket subscriber has time to process the log event.
  await new Promise<void>((r) => setTimeout(r, 3000));

  const agentPubkey = agentKeypair.publicKey.toBase58();
  const histUrl = `${INDEXER_URL}/v1/agents/${agentPubkey}/reputation/history?limit=10`;

  console.log(fmt("Endpoint:", histUrl));

  let historyData: { entries: Array<{ outcome: number; scoreDelta: number; timestamp: number; pactId: string }>; nextCursor?: string } | null = null;
  try {
    const res = await fetch(histUrl, { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      historyData = await res.json() as typeof historyData;
    } else {
      console.log(`  ⚠ Indexer returned HTTP ${res.status} — may not be deployed yet`);
    }
  } catch {
    console.log("  ⚠ Could not reach indexer — set INDEXER_URL to the running indexer endpoint");
  }

  if (historyData !== null && historyData!.entries.length > 0) {
    console.log("\n  History:");
    console.log("  " + hr("─", 62));
    console.log("  #   Outcome      Delta    Timestamp                  PactID");
    console.log("  " + hr("─", 62));
    historyData!.entries.forEach((e, i) => {
      const ts = new Date(e.timestamp * 1000).toISOString().replace("T", " ").slice(0, 19);
      const delta = e.scoreDelta >= 0 ? `+${e.scoreDelta}` : String(e.scoreDelta);
      const outcome = outcomeLabel(e.outcome).padEnd(12);
      console.log(`  ${String(i + 1).padStart(2)}  ${outcome} ${delta.padStart(5)}    ${ts}  ${e.pactId}`);
    });
    console.log("  " + hr("─", 62));
    if (historyData!.nextCursor) {
      console.log(`  Cursor for next page: ${historyData!.nextCursor}`);
    }
  } else if (historyData !== null) {
    console.log("  (no history entries yet — indexer may still be catching up)");
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log("\n" + hr());
  console.log("  Demo complete.");
  console.log("");
  console.log("  Agent pubkey:    " + agentKeypair.publicKey.toBase58());
  console.log("  Reputation PDA:  " + repPda.toBase58());
  console.log("  Score:           " + score + " / 10000 bp");
  console.log("  Agent wallet:    " + walletPda.toBase58());
  console.log("");
  console.log("  Holdfast: programmable trust rails for AI agent economies.");
  console.log(hr());
  console.log("  DEVNET DEMONSTRATION ONLY");
  console.log("  Holdfast programs have not been formally audited.");
  console.log("  Not for production use. No security guarantees.");
  console.log(hr() + "\n");
}

main().catch((err: unknown) => {
  console.error("\n[demo] Fatal error:", err);
  process.exit(1);
});

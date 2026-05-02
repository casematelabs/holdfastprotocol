import * as anchor from "@coral-xyz/anchor";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { p256 } = require("../oracle/node_modules/@noble/curves/nist.js");

const RPC_URL = process.env["ANCHOR_PROVIDER_URL"] ?? "https://api.devnet.solana.com";
const PAYER_KEYPAIR_PATH = process.env["PAYER_KEYPAIR_PATH"] ?? "~/.config/solana/devnet.json";

const HOLDFAST_PROGRAM_ID = new anchor.web3.PublicKey("2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq");
const SYSVAR_INSTRUCTIONS = new anchor.web3.PublicKey("Sysvar1nstructions1111111111111111111111111");
const SECP256R1_PROGRAM_ID = new anchor.web3.PublicKey(
  Buffer.from([6, 146, 13, 236, 47, 234, 113, 181, 183, 35, 129, 77, 116, 45, 169, 3, 28, 131, 231, 95, 219, 121, 93, 86, 142, 117, 71, 128, 32, 0, 0, 0]),
);

function loadKeypair(filePath: string): anchor.web3.Keypair {
  const resolved = filePath.replace(/^~/, os.homedir());
  const raw = JSON.parse(fs.readFileSync(resolved, "utf8")) as number[];
  return anchor.web3.Keypair.fromSecretKey(Uint8Array.from(raw));
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
  return new anchor.web3.TransactionInstruction({
    programId: SECP256R1_PROGRAM_ID,
    keys: [],
    data,
  });
}

async function main(): Promise<void> {
  const payer = loadKeypair(PAYER_KEYPAIR_PATH);
  const connection = new anchor.web3.Connection(RPC_URL, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const version = await connection.getVersion();
  const payerBalance = await connection.getBalance(payer.publicKey);
  console.log(`[probe] rpc: ${RPC_URL}`);
  console.log(`[probe] getVersion: ${JSON.stringify(version)}`);
  console.log(`[probe] payer: ${payer.publicKey.toBase58()} (${payerBalance} lamports)`);

  const holdfastIdl = require("../target/idl/vaultpact.json");
  const holdfastProgram = new anchor.Program(holdfastIdl, provider);
  if (!holdfastProgram.programId.equals(HOLDFAST_PROGRAM_ID)) {
    throw new Error(`Holdfast program id mismatch: idl=${holdfastProgram.programId.toBase58()} expected=${HOLDFAST_PROGRAM_ID.toBase58()}`);
  }

  const [registryPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("attestation_registry")],
    holdfastProgram.programId,
  );
  const registryInfo = await connection.getAccountInfo(registryPda, "confirmed");
  if (registryInfo === null) {
    throw new Error(`attestation_registry missing at ${registryPda.toBase58()}`);
  }

  const privKey = p256.utils.randomPrivateKey();
  const uncompressed: Uint8Array = p256.getPublicKey(privKey, false);
  const compressed: Uint8Array = p256.getPublicKey(privKey, true);
  const pubkeyX = Buffer.from(uncompressed.slice(1, 33));
  const pubkeyY = Buffer.from(uncompressed.slice(33, 65));
  const [walletPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("agent_wallet"), pubkeyX, pubkeyY],
    holdfastProgram.programId,
  );

  const preimage = buildRegistrationPreimage(payer.publicKey, pubkeyX, pubkeyY);
  const preimageHash = crypto.createHash("sha256").update(preimage).digest();
  const sigBytes = p256.sign(preimageHash, privKey).toCompactRawBytes();
  const secpIx = buildSecp256r1Instruction(sigBytes, compressed, preimageHash);
  const registerIx = await holdfastProgram.methods
    .registerAgentWallet(Array.from(pubkeyX), Array.from(pubkeyY))
    .accounts({
      agentWallet: walletPda,
      attestationRegistry: registryPda,
      payer: payer.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
      instructions: SYSVAR_INSTRUCTIONS,
    })
    .instruction();

  const tx = new anchor.web3.Transaction().add(secpIx, registerIx);
  try {
    const sig = await provider.sendAndConfirm(tx, [payer]);
    console.log(`[probe] status: PASS`);
    console.log(`[probe] tx: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
    return;
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    const logs = Array.isArray(err?.logs) ? err.logs.join(" | ") : "";
    console.log(`[probe] status: FAIL`);
    console.log(`[probe] error: ${msg}`);
    if (logs) console.log(`[probe] logs: ${logs}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

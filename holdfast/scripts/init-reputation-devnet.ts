import * as anchor from "@coral-xyz/anchor";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const RPC_URL = process.env["ANCHOR_PROVIDER_URL"] ?? "https://api.devnet.solana.com";
const PROGRAM_ID = new anchor.web3.PublicKey(process.env["HOLDFAST_PROGRAM_ID"] ?? "2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq");

function loadKeypair(filePath: string): anchor.web3.Keypair {
  const resolved = filePath.replace(/^~/, os.homedir());
  const raw = JSON.parse(fs.readFileSync(resolved, "utf8")) as number[];
  return anchor.web3.Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main(): Promise<void> {
  const keypairPath = process.env["KEYPAIR_PATH"] ?? "~/.config/solana/agent-a.json";
  const signer = loadKeypair(keypairPath);

  const connection = new anchor.web3.Connection(RPC_URL, "confirmed");
  const wallet = new anchor.Wallet(signer);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });

  const idlPath = path.join(__dirname, "..", "target", "idl", "vaultpact.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8")) as anchor.Idl;
  const program = new anchor.Program(idl, provider);

  const [repPda] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("reputation"), signer.publicKey.toBuffer()],
    PROGRAM_ID,
  );

  const existing = await connection.getAccountInfo(repPda);
  if (existing) {
    console.log("Reputation account already exists:", repPda.toBase58());
    return;
  }

  const sig = await program.methods
    .initReputation()
    .accounts({
      agent: signer.publicKey,
      reputationAccount: repPda,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([signer])
    .rpc();

  console.log("Initialized reputation account:", repPda.toBase58());
  console.log("Signature:", sig);
  console.log(`Explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});

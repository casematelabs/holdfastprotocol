import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, Connection, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import idl from "../target/idl/vaultpact.json";

const PROGRAM_ID = new PublicKey(process.env["HOLDFAST_PROGRAM_ID"] ?? "2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq");
const ESCROW_PROGRAM_ID = new PublicKey("CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi");

function withLegacyAccountTypes(rawIdl: any): any {
  const next = JSON.parse(JSON.stringify(rawIdl));
  const typeByName = new Map<string, any>((next.types ?? []).map((t: any) => [t.name, t.type]));
  if (Array.isArray(next.accounts)) {
    next.accounts = next.accounts.map((acct: any) => {
      if (acct?.type) return acct;
      const legacyType = typeByName.get(acct?.name);
      return legacyType ? { ...acct, type: legacyType } : acct;
    });
  }
  // Anchor TS in this workspace fails account namespace construction for this IDL shape.
  // initialize_registry only needs instruction namespace, so drop account namespace.
  next.accounts = [];
  return next;
}

async function main() {
  const authorityPath = path.join(__dirname, "..", "keys", "devnet-protocol-authority.json");
  if (!fs.existsSync(authorityPath)) {
    console.error("Missing keys/devnet-protocol-authority.json — see docs/governance-devnet.md");
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(authorityPath, "utf-8"));
  const keypair = Keypair.fromSecretKey(Uint8Array.from(raw));

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const compatibleIdl = withLegacyAccountTypes(idl);
  compatibleIdl.address = PROGRAM_ID.toBase58();
  const program = new Program(compatibleIdl as any, provider as any) as any;

  const [registryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("attestation_registry")],
    PROGRAM_ID
  );

  console.log("Authority:", keypair.publicKey.toBase58());
  console.log("Registry PDA:", registryPda.toBase58());
  console.log("Sending initialize_registry...");

  const tx = await program.methods
    .initializeRegistry()
    .accounts({
      authority: keypair.publicKey,
      escrowProgram: ESCROW_PROGRAM_ID,
    })
    .rpc();

  console.log("Transaction signature:", tx);

  console.log("Registry initialized.");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

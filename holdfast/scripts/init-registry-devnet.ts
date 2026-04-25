import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, Connection, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import idl from "../target/idl/vaultpact.json";

const PROGRAM_ID = new PublicKey("D6mUa4wGtFyLyJorMfxoKvA9ybohjUSsfw88t66ATxg");
const ESCROW_PROGRAM_ID = new PublicKey("BNxA76z6vjQYtUJXGpH8qjA3wHvtAAqGqL6rvVWH6b3H");

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

  const program = new Program(idl as any, provider);

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

  const registryAccount = await program.account.attestationRegistry.fetch(registryPda);
  console.log("Registry initialized:");
  console.log("  authority:", registryAccount.authority.toBase58());
  console.log("  agent_count:", registryAccount.agentCount.toString());
  console.log("  bump:", registryAccount.bump);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

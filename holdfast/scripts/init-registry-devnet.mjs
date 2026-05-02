import * as anchor from "@coral-xyz/anchor";
import { Keypair, Connection, PublicKey } from "@solana/web3.js";
import fs from "fs";
import os from "os";
import path from "path";

const PROGRAM_ID = new PublicKey("2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq");
const ESCROW_PROGRAM_ID = new PublicKey("CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi");

const walletPath = path.join(os.homedir(), ".config", "solana", "devnet.json");
const raw = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
const keypair = Keypair.fromSecretKey(Uint8Array.from(raw));

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const wallet = new anchor.Wallet(keypair);
const provider = new anchor.AnchorProvider(connection, wallet, {
  commitment: "confirmed",
});
anchor.setProvider(provider);

const idlPath = path.resolve("target/idl/vaultpact.json");
const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
const program = new anchor.Program(idl, provider);

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

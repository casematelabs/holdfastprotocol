/**
 * test-vote.ts — manually submit a test update_reputation instruction via the oracle Voter.
 *
 * Usage:
 *   node --loader ts-node/esm scripts/test-vote.ts
 *
 * The target agent defaults to the devnet payer keypair at ~/.config/solana/devnet.json.
 * Override with TEST_AGENT_PUBKEY env var (the agent must have an initialized ReputationAccount).
 *
 * If the ReputationAccount does not exist, run `yarn demo` from the holdfast root first — it
 * calls init_reputation as step 3/5.
 *
 * Prerequisites: oracle keypair at ~/.config/solana/oracle-devnet.json (or ORACLE_KEYPAIR_PATH)
 */

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createHash, randomBytes } from "node:crypto";
import { loadConfig } from "../src/config.js";
import { Voter } from "../src/voter.js";
import { PactOutcome } from "../src/types.js";

function loadKeypairFile(rawPath: string): Keypair {
  const expanded = rawPath.startsWith("~") ? rawPath.replace("~", homedir()) : rawPath;
  const bytes = JSON.parse(readFileSync(expanded, "utf8")) as number[];
  return Keypair.fromSecretKey(new Uint8Array(bytes));
}

async function main(): Promise<void> {
  const config = loadConfig();

  // Resolve test agent pubkey: env var > devnet payer keypair.
  let agentPubkey: PublicKey;
  if (process.env["TEST_AGENT_PUBKEY"]) {
    agentPubkey = new PublicKey(process.env["TEST_AGENT_PUBKEY"]);
  } else {
    const payerPath = process.env["PAYER_KEYPAIR_PATH"] ?? "~/.config/solana/devnet.json";
    const payer = loadKeypairFile(payerPath);
    agentPubkey = payer.publicKey;
  }

  const [repPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("reputation"), agentPubkey.toBuffer()],
    config.holdfastProgramId,
  );

  console.log("[test-vote] Oracle authority: ", config.oracleKeypair.publicKey.toBase58());
  console.log("[test-vote] Holdfast program:", config.holdfastProgramId.toBase58());
  console.log("[test-vote] Test agent:        ", agentPubkey.toBase58());
  console.log("[test-vote] Reputation PDA:    ", repPda.toBase58());

  // Check account exists before attempting the vote.
  const info = await config.connection.getAccountInfo(repPda, "confirmed");
  if (info === null) {
    console.error(
      `[test-vote] ReputationAccount not found at ${repPda.toBase58()}.\n` +
      `  Run 'yarn demo' from the holdfast root to initialize it first (step 3/5).`,
    );
    process.exit(1);
  }

  const pactId = randomBytes(7);
  const voter = new Voter(config.connection, config.holdfastProgramId, config.oracleKeypair);

  const sig = await voter.submitUpdate({
    agentPubkey: agentPubkey.toBase58(),
    onChainOutcome: PactOutcome.Fulfilled,
    scoreDelta: 20,
    pactId,
  });

  console.log(`[test-vote] Vote submitted successfully.`);
  console.log(`[test-vote] Sig: ${sig}`);
  console.log(`[test-vote] Explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
}

main().catch((err: unknown) => {
  console.error("[test-vote] Fatal:", err);
  process.exit(1);
});

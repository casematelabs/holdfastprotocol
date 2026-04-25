/**
 * Stress Test — Reputation Stake/Slash Throughput
 *
 * Registers N agent wallets, initializes reputation, then fires rapid
 * update_reputation calls (score bumps + slashes) to measure oracle-driven
 * throughput and detect contention.
 *
 * Usage:
 *   STRESS_CONCURRENCY=25 npx ts-node --transpile-only -P tsconfig.json stress-tests/reputation-load.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { MetricsCollector } from "./lib/metrics";
import {
  setupDevnetContext,
  getConcurrency,
  getOutputDir,
  confirmAndGetMeta,
  registerAgentWallet,
  initReputation,
  airdropIfNeeded,
  printSummary,
  runWithConcurrency,
  loadKeypair,
  type DevnetContext,
} from "./lib/setup";
import * as os from "os";
import * as path from "path";

const BUMPS_PER_AGENT = 5;
const SLASHES_PER_AGENT = 2;
const BUMP_AMOUNT = 50;
const SLASH_AMOUNT = 20;

interface AgentState {
  keypair: anchor.web3.Keypair;
  walletPda: anchor.web3.PublicKey;
  repPda: anchor.web3.PublicKey;
}

async function loadOracleAuthority(): Promise<anchor.web3.Keypair> {
  const oraclePath =
    process.env["ORACLE_KEYPAIR"] ??
    path.join(os.homedir(), ".config", "solana", "oracle-devnet.json");
  return loadKeypair(oraclePath);
}

async function registerAgents(
  ctx: DevnetContext,
  count: number,
  metrics: MetricsCollector,
): Promise<AgentState[]> {
  const agents: AgentState[] = [];

  for (let i = 0; i < count; i++) {
    console.log(`  Registering agent ${i + 1}/${count}...`);
    const keypair = anchor.web3.Keypair.generate();
    await airdropIfNeeded(ctx, keypair.publicKey);

    const regResult = await metrics.trackTx(
      "register_agent_wallet",
      async () => {
        const { walletPda } = await registerAgentWallet(ctx, keypair);
        // Store walletPda so we can retrieve it after
        (keypair as any).__walletPda = walletPda;
        return "manual";
      },
      async () => ({ slot: 0, computeUnits: null }),
    );

    const walletPda = (keypair as any).__walletPda as anchor.web3.PublicKey;
    delete (keypair as any).__walletPda;

    const repPda = await metrics.trackTx(
      "init_reputation",
      async () => {
        const pda = await initReputation(ctx, keypair);
        (keypair as any).__repPda = pda;
        return "manual";
      },
      async () => ({ slot: 0, computeUnits: null }),
    ).then(() => {
      const pda = (keypair as any).__repPda as anchor.web3.PublicKey;
      delete (keypair as any).__repPda;
      return pda;
    });

    agents.push({ keypair, walletPda, repPda });
  }

  return agents;
}

async function runReputationUpdates(
  ctx: DevnetContext,
  metrics: MetricsCollector,
  agent: AgentState,
  oracleAuthority: anchor.web3.Keypair,
  agentIndex: number,
): Promise<void> {
  const label = `agent-${agentIndex}`;

  // Score bumps
  for (let i = 0; i < BUMPS_PER_AGENT; i++) {
    await metrics.trackTx(
      "update_reputation_bump",
      async () => {
        return ctx.holdfastProgram.methods
          .updateReputation(
            new anchor.BN(BUMP_AMOUNT),
            0, // Fulfilled outcome
          )
          .accounts({
            oracleAuthority: oracleAuthority.publicKey,
            reputationAccount: agent.repPda,
          })
          .signers([oracleAuthority])
          .rpc();
      },
      (sig) => confirmAndGetMeta(ctx.connection, sig),
    );
    console.log(`  [${label}] bump ${i + 1}/${BUMPS_PER_AGENT}`);
  }

  // Slashes
  for (let i = 0; i < SLASHES_PER_AGENT; i++) {
    await metrics.trackTx(
      "update_reputation_slash",
      async () => {
        return ctx.holdfastProgram.methods
          .updateReputation(
            new anchor.BN(SLASH_AMOUNT),
            1, // Disputed outcome
          )
          .accounts({
            oracleAuthority: oracleAuthority.publicKey,
            reputationAccount: agent.repPda,
          })
          .signers([oracleAuthority])
          .rpc();
      },
      (sig) => confirmAndGetMeta(ctx.connection, sig),
    );
    console.log(`  [${label}] slash ${i + 1}/${SLASHES_PER_AGENT}`);
  }

  // Validate reputation
  await metrics.trackTx(
    "validate_reputation_for_pact",
    async () => {
      return ctx.holdfastProgram.methods
        .validateReputationForPact(
          new anchor.BN(0), // min score
          0, // min tier
          new anchor.BN(0), // min pacts
        )
        .accounts({
          reputationAccount: agent.repPda,
        })
        .rpc();
    },
    (sig) => confirmAndGetMeta(ctx.connection, sig),
  );
  console.log(`  [${label}] validate_reputation_for_pact done`);
}

async function main(): Promise<void> {
  const agentCount = getConcurrency();
  console.log(`\nReputation Load Test — ${agentCount} agents\n`);

  console.log("Setting up devnet context...");
  const ctx = await setupDevnetContext();
  const metrics = new MetricsCollector("reputation-load", agentCount);

  console.log("Loading oracle authority...");
  const oracleAuthority = await loadOracleAuthority();
  await airdropIfNeeded(ctx, oracleAuthority.publicKey);

  console.log(`Registering ${agentCount} agent wallets + reputation PDAs...\n`);
  const agents = await registerAgents(ctx, agentCount, metrics);

  console.log(
    `\nRunning reputation updates (${BUMPS_PER_AGENT} bumps + ${SLASHES_PER_AGENT} slashes per agent)...\n`,
  );
  metrics.start();

  const tasks = agents.map(
    (agent, i) => () =>
      runReputationUpdates(ctx, metrics, agent, oracleAuthority, i),
  );

  // Run reputation updates concurrently but cap at 5 to avoid oracle signer contention
  const updateConcurrency = Math.min(agentCount, 5);
  await runWithConcurrency(tasks, updateConcurrency);

  const { dir, summary } = metrics.writeResults(getOutputDir());
  printSummary(summary as unknown as Record<string, unknown>);
  console.log(`Results written to: ${dir}`);
}

main().catch((err) => {
  console.error("Stress test failed:", err);
  process.exit(1);
});

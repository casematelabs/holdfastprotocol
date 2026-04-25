import { loadConfig } from "./config.js";
import { DisputeSubscriber } from "./subscriber.js";
import { evaluateDispute } from "./evaluator.js";
import { Voter } from "./voter.js";
import { PendingQueue } from "./pending.js";
import { AgentRegistrySubscriber } from "./agent-registry/subscriber.js";
import { AgentRegistryResponder } from "./agent-registry/responder.js";
import { AtomEngineSubmitter } from "./agent-registry/atom-engine-submitter.js";
import type { DisputeEvent } from "./types.js";
import type { ValidationRequestedEvent } from "./agent-registry/types.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const voter = new Voter(config.connection, config.holdfastProgramId, config.oracleKeypair, config.vaultpactIdl);
  const pending = new PendingQueue(config.voteTimeoutSeconds);
  const atomSubmitter = new AtomEngineSubmitter(
    config.connection,
    config.atomBridgeProgramId,
    config.atomEngineProgramId,
    config.atomBridgeConfigPubkey,
    config.oracleKeypair,
  );

  console.log("[oracle] Holdfast reputation oracle starting (single-node devnet mode)");
  console.log(`[oracle] Oracle authority:     ${config.oracleKeypair.publicKey.toBase58()}`);
  console.log(`[oracle] Holdfast program:     ${config.holdfastProgramId.toBase58()}`);
  console.log(`[oracle] Escrow program:       ${config.escrowProgramId.toBase58()}`);
  console.log(`[oracle] Agent Registry:       ${config.agentRegistryProgramId?.toBase58() ?? "not configured (CAS-45 pending)"}`);
  console.log(`[oracle] ATOM Engine:          ${config.atomEngineProgramId.toBase58()}`);
  console.log(`[oracle] ATOM Bridge:          ${config.atomBridgeProgramId.toBase58()}`);
  console.log(`[oracle] Vote timeout:         ${config.voteTimeoutSeconds / 3600}h`);

  const subscriber = new DisputeSubscriber(
    config.connection,
    config.escrowProgramId,
    async (event: DisputeEvent) => {
      console.log(
        `[oracle] Dispute detected: pact=${event.pactId.toString("hex")} ` +
        `agent=${event.agentPubkey.slice(0, 8)}... outcome=${event.outcome}`,
      );
      pending.add(event);

      // Single-node devnet: quorum is immediately met. Submit both updates now.
      const [agentUpdate, counterpartyUpdate] = evaluateDispute(event);
      try {
        await voter.submitUpdate(agentUpdate);
        await voter.submitUpdate(counterpartyUpdate);
        pending.remove(event);
      } catch (err) {
        console.error(`[oracle] Failed to submit updates for pact=${event.pactId.toString("hex")}:`, err);
        // Leave in pending queue — deadline checker will surface it.
      }
    },
  );

  subscriber.start();

  // Agent Registry stub: only start if program ID is configured (CAS-45 pending).
  let arSubscriber: AgentRegistrySubscriber | null = null;
  if (config.agentRegistryProgramId !== null) {
    const arResponder = new AgentRegistryResponder(config.connection, config.agentRegistryProgramId, config.oracleKeypair);
    arSubscriber = new AgentRegistrySubscriber(
      config.connection,
      config.agentRegistryProgramId,
      async (event: ValidationRequestedEvent) => {
        console.log(
          `[oracle] ValidationRequested: asset=${event.asset.slice(0, 8)}... ` +
          `validator=${event.validatorAddress.slice(0, 8)}... nonce=${event.nonce}`,
        );
        const result = arResponder.buildStubResult(event);
        try {
          await arResponder.submitResponse(result);
        } catch (err) {
          console.error(
            `[oracle] Failed to submit respond_to_validation for asset=${event.asset.slice(0, 8)}... nonce=${event.nonce}:`,
            err,
          );
        }
      },
    );
    arSubscriber.start();
  }

  // Periodic ATOM Engine trust signal emission.
  const atomTarget = config.atomTrustSignalTarget;
  const atomSignalInterval = atomTarget !== null
    ? setInterval(() => {
        const signal = atomSubmitter.buildStubSignal();
        atomSubmitter.submitTrustSignal(atomTarget, signal).catch((err: unknown) => {
          console.error("[oracle] ATOM trust signal submission failed:", err);
        });
      }, config.atomSignalIntervalMs)
    : null;

  if (atomTarget !== null) {
    console.log(
      `[oracle] ATOM trust signal loop:  snapshot=${atomTarget.atomLegitSnapshotPubkey.toBase58()} ` +
      `interval=${config.atomSignalIntervalMs / 1000}s`,
    );
  }

  // Check for missed deadlines every hour.
  const deadlineInterval = setInterval(() => pending.checkDeadlines(), 60 * 60 * 1000);

  const shutdown = async (): Promise<void> => {
    console.log("[oracle] Shutting down...");
    clearInterval(deadlineInterval);
    if (atomSignalInterval !== null) clearInterval(atomSignalInterval);
    await subscriber.stop();
    await arSubscriber?.stop();
    if (pending.size() > 0) {
      console.warn(`[oracle] Exiting with ${pending.size()} unsubmitted dispute(s) in queue.`);
    }
    process.exit(0);
  };

  process.on("SIGINT",  () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  console.log("[oracle] Listening for dispute events and Agent Registry validation requests. Press Ctrl+C to stop.");
}

main().catch((err: unknown) => {
  console.error("[oracle] Fatal error:", err);
  process.exit(1);
});

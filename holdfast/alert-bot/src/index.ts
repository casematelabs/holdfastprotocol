import { loadConfig } from "./config.js";
import { DiscordWebhookSender } from "./discord.js";
import { AlertRouter } from "./alert-router.js";
import { IndexerPoller } from "./pollers/indexer-poller.js";
import { EscrowPoller } from "./pollers/escrow-poller.js";
import { OraclePoller } from "./pollers/oracle-poller.js";
import { ProgramPoller } from "./pollers/program-poller.js";
import { RpcPoller } from "./pollers/rpc-poller.js";
import type { CheckResult } from "./types.js";

interface Poller {
  check(): Promise<CheckResult[]>;
}

async function runPoller(
  label: string,
  poller: Poller,
  router: AlertRouter,
): Promise<void> {
  try {
    const results = await poller.check();
    for (const result of results) {
      await router.route(result);
    }
  } catch (err) {
    console.error(`[alert-bot] Poller "${label}" threw unexpectedly:`, err);
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const sender = new DiscordWebhookSender(config.discordWebhookUrl);
  const router = new AlertRouter(sender, config.alertCooldownMs);

  const indexerPoller = new IndexerPoller(config);
  const escrowPoller = new EscrowPoller(config);
  const oraclePoller = new OraclePoller(config);
  const programPoller = new ProgramPoller(config);
  const rpcPoller = new RpcPoller(config);

  console.log("[alert-bot] Holdfast devnet alert bot starting");
  console.log(`[alert-bot] Indexer:        ${config.indexerUrl}`);
  console.log(`[alert-bot] RPC:            ${config.rpcUrl}`);
  console.log(`[alert-bot] Oracle URL:     ${config.oracleUrl ?? "not configured"}`);
  console.log(`[alert-bot] Alert cooldown: ${config.alertCooldownMs / 1000}s`);

  await sender.sendAlert(
    "🟢 Alert bot started",
    `Holdfast devnet alert bot is online.\nIndexer: \`${config.indexerUrl}\`\nRPC: \`${config.rpcUrl}\``,
    "info",
  );

  // Run all pollers once immediately on startup
  await runPoller("indexer", indexerPoller, router);
  await runPoller("escrow", escrowPoller, router);
  await runPoller("oracle", oraclePoller, router);
  await runPoller("program", programPoller, router);
  await runPoller("rpc", rpcPoller, router);

  const intervals: ReturnType<typeof setInterval>[] = [
    setInterval(
      () => void runPoller("indexer", indexerPoller, router),
      config.intervals.indexerMs,
    ),
    setInterval(
      () => void runPoller("escrow", escrowPoller, router),
      config.intervals.escrowMs,
    ),
    setInterval(
      () => void runPoller("oracle", oraclePoller, router),
      config.intervals.oracleMs,
    ),
    setInterval(
      () => void runPoller("program", programPoller, router),
      config.intervals.programMs,
    ),
    setInterval(
      () => void runPoller("rpc", rpcPoller, router),
      config.intervals.rpcMs,
    ),
  ];

  const shutdown = async (): Promise<void> => {
    console.log("[alert-bot] Shutting down...");
    for (const interval of intervals) clearInterval(interval);
    try {
      await sender.sendAlert(
        "🔴 Alert bot stopped",
        "Holdfast devnet alert bot has shut down.",
        "info",
      );
    } catch {
      // best-effort shutdown notification
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  console.log("[alert-bot] All pollers running. Press Ctrl+C to stop.");
}

main().catch((err: unknown) => {
  console.error("[alert-bot] Fatal error:", err);
  process.exit(1);
});

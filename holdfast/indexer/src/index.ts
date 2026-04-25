import { Connection, PublicKey } from "@solana/web3.js";
import { EventStore } from "./store.js";
import { ReputationSubscriber } from "./subscriber.js";
import { EscrowSubscriber } from "./escrow-subscriber.js";
import { createApiServer } from "./server.js";

const PROGRAM_ID =
  process.env["PROGRAM_ID"] ??
  "D6mUa4wGtFyLyJorMfxoKvA9ybohjUSsfw88t66ATxg";

const ESCROW_PROGRAM_ID =
  process.env["ESCROW_PROGRAM_ID"] ??
  "BNxA76z6vjQYtUJXGpH8qjA3wHvtAAqGqL6rvVWH6b3H";

const RPC_URL =
  process.env["SOLANA_RPC_URL"] ?? "https://api.devnet.solana.com";

// WebSocket endpoint: ws:// counterpart of the RPC URL.
// When SOLANA_WS_URL is set explicitly, use it; otherwise derive from RPC_URL.
const WS_URL =
  process.env["SOLANA_WS_URL"] ??
  RPC_URL.replace(/^https?:/, (p) => (p === "https:" ? "wss:" : "ws:"));

const DB_PATH = process.env["DB_PATH"] ?? "reputation.db";
const PORT = parseInt(process.env["PORT"] ?? "3001", 10);

async function main(): Promise<void> {
  console.log(`[indexer] Program ID        : ${PROGRAM_ID}`);
  console.log(`[indexer] Escrow Program ID : ${ESCROW_PROGRAM_ID}`);
  console.log(`[indexer] RPC URL           : ${RPC_URL}`);
  console.log(`[indexer] WS URL            : ${WS_URL}`);
  console.log(`[indexer] DB path           : ${DB_PATH}`);
  console.log(`[indexer] API port          : ${PORT}`);

  const programId = new PublicKey(PROGRAM_ID);
  const escrowProgramId = new PublicKey(ESCROW_PROGRAM_ID);
  const connection = new Connection(RPC_URL, {
    wsEndpoint: WS_URL,
    commitment: "confirmed",
  });

  const store = new EventStore(DB_PATH);

  const subscriber = new ReputationSubscriber(connection, programId, store);
  subscriber.start();

  const escrowSubscriber = new EscrowSubscriber(connection, escrowProgramId, store);
  escrowSubscriber.start();

  // Prune expired cancel intents every 5 minutes.
  setInterval(() => store.pruneExpiredIntents(), 5 * 60 * 1000);

  const server = createApiServer(store);
  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(PORT, () => {
      console.log(`[indexer] API listening on http://0.0.0.0:${PORT}`);
      resolve();
    });
  });

  // Graceful shutdown.
  const shutdown = async (): Promise<void> => {
    console.log("[indexer] Shutting down…");
    await Promise.all([subscriber.stop(), escrowSubscriber.stop()]);
    server.close();
    store.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

main().catch((err: unknown) => {
  console.error("[indexer] Fatal:", err);
  process.exit(1);
});

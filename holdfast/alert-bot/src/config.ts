export interface AlertBotConfig {
  discordWebhookUrl: string;
  indexerUrl: string;
  rpcUrl: string;
  oracleUrl: string | null;
  holdfastProgramId: string;
  escrowProgramId: string;
  alertCooldownMs: number;
  intervals: {
    indexerMs: number;
    escrowMs: number;
    oracleMs: number;
    programMs: number;
    rpcMs: number;
  };
  rpcSlotLagThreshold: number;
  programBaselineHashes: {
    holdfast: string | null;
    escrow: string | null;
  };
}

export function loadConfig(): AlertBotConfig {
  const webhookUrl = process.env["DISCORD_WEBHOOK_URL"];
  if (!webhookUrl) {
    throw new Error("DISCORD_WEBHOOK_URL is required");
  }

  return {
    discordWebhookUrl: webhookUrl,
    indexerUrl: process.env["INDEXER_URL"] ?? "http://localhost:3000",
    rpcUrl: process.env["RPC_URL"] ?? "https://api.devnet.solana.com",
    oracleUrl: process.env["ORACLE_URL"] ?? null,
    holdfastProgramId:
      process.env["HOLDFAST_PROGRAM_ID"] ??
      "2chF47DbqehX3L38874e2RznaSs46vpcMPEPRYz4Dywq",
    escrowProgramId:
      process.env["ESCROW_PROGRAM_ID"] ??
      "CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi",
    alertCooldownMs:
      parseInt(process.env["ALERT_COOLDOWN_SECONDS"] ?? "300", 10) * 1000,
    intervals: {
      indexerMs:
        parseInt(process.env["INDEXER_POLL_INTERVAL_SECONDS"] ?? "60", 10) * 1000,
      escrowMs:
        parseInt(process.env["ESCROW_POLL_INTERVAL_SECONDS"] ?? "60", 10) * 1000,
      oracleMs:
        parseInt(process.env["ORACLE_POLL_INTERVAL_SECONDS"] ?? "300", 10) * 1000,
      programMs:
        parseInt(process.env["PROGRAM_POLL_INTERVAL_SECONDS"] ?? "600", 10) * 1000,
      rpcMs:
        parseInt(process.env["RPC_POLL_INTERVAL_SECONDS"] ?? "300", 10) * 1000,
    },
    rpcSlotLagThreshold: parseInt(
      process.env["RPC_SLOT_LAG_THRESHOLD"] ?? "100",
      10,
    ),
    programBaselineHashes: {
      holdfast: process.env["HOLDFAST_PROGRAM_BASELINE_HASH"] ?? null,
      escrow: process.env["ESCROW_PROGRAM_BASELINE_HASH"] ?? null,
    },
  };
}

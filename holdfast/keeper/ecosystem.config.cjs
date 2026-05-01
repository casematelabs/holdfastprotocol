// PM2 ecosystem config for the Holdfast Keeper service
const path = require("path");
const os = require("os");
const KEYPAIR_PATH = path.join(os.homedir(), ".config", "solana", "id.json");

module.exports = {
  apps: [
    {
      name: "holdfast-keeper",
      script: "start.cjs",
      cwd: __dirname,
      interpreter: "node",
      env_dry_run: {
        NODE_ENV: "production",
        HOLDFAST_RPC_URL: "https://api.devnet.solana.com",
        KEEPER_KEYPAIR_PATH: KEYPAIR_PATH,
        KEEPER_POLL_INTERVAL_SECONDS: "30",
        KEEPER_LOOKAHEAD_SECONDS: "120",
        KEEPER_DRY_RUN: "true",
        KEEPER_HEALTH_PORT: "8888",
        HOLDFAST_PROGRAM_ID: "D6mUa4wGtFyLyJorMfxoKvA9ybohjUSsfw88t66ATxg",
        HOLDFAST_ESCROW_PROGRAM_ID: "CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi",
      },
      env_live: {
        NODE_ENV: "production",
        HOLDFAST_RPC_URL: "https://api.devnet.solana.com",
        KEEPER_KEYPAIR_PATH: KEYPAIR_PATH,
        KEEPER_POLL_INTERVAL_SECONDS: "30",
        KEEPER_LOOKAHEAD_SECONDS: "120",
        KEEPER_DRY_RUN: "false",
        KEEPER_HEALTH_PORT: "8888",
        HOLDFAST_PROGRAM_ID: "D6mUa4wGtFyLyJorMfxoKvA9ybohjUSsfw88t66ATxg",
        HOLDFAST_ESCROW_PROGRAM_ID: "CAZMkHiExVjbsSwAVBYVhz1yaHmnBSvzUYGaQrrRp6yi",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
  ],
};

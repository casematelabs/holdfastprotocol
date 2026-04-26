// CJS wrapper for PM2 compatibility on Windows with ESM modules
const { spawn } = require("child_process");
const path = require("path");

const entry = path.join(__dirname, "dist", "index.js");
const child = spawn(process.execPath, [entry], {
  env: process.env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  process.exit(code ?? 1);
});

process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));

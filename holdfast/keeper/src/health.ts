import * as http from "http";
import { log } from "./logger.js";

export interface HealthState {
  startedAt: string;
  keeperPubkey: string;
  rpcUrl: string;
  dryRun: boolean;
  lastPollAt: string | null;
  lastPollResult: Record<string, unknown> | null;
}

let state: HealthState = {
  startedAt: new Date().toISOString(),
  keeperPubkey: "",
  rpcUrl: "",
  dryRun: false,
  lastPollAt: null,
  lastPollResult: null,
};

export function updateHealthState(patch: Partial<HealthState>): void {
  state = { ...state, ...patch };
}

export function startHealthServer(port: number): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url === "/health" || req.url === "/") {
      const body = JSON.stringify(
        {
          status: "ok",
          uptimeSecs: Math.floor(
            (Date.now() - new Date(state.startedAt).getTime()) / 1000,
          ),
          ...state,
        },
        null,
        2,
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(body);
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
    }
  });

  server.listen(port, () => {
    log("info", "keeper_health_server_started", { port });
  });

  return server;
}

import type { AlertBotConfig } from "../config.js";
import type { CheckResult } from "../types.js";

export class OraclePoller {
  constructor(private readonly config: AlertBotConfig) {}

  async check(): Promise<CheckResult[]> {
    if (this.config.oracleUrl === null) {
      // Oracle health monitoring is optional — skip silently when not configured
      return [];
    }

    const url = `${this.config.oracleUrl}/health`;
    let resp: Response;
    try {
      resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    } catch (err) {
      return [
        {
          healthy: false,
          category: "oracle",
          summary: "Oracle unreachable",
          detail: `${(err as Error).message} (${url})`,
          severity: "critical",
        },
      ];
    }

    if (!resp.ok) {
      return [
        {
          healthy: false,
          category: "oracle",
          summary: "Oracle health degraded",
          detail: `HTTP ${resp.status} from ${url}`,
          severity: resp.status >= 500 ? "critical" : "warning",
        },
      ];
    }

    return [
      {
        healthy: true,
        category: "oracle",
        summary: "Oracle healthy",
        severity: "info",
      },
    ];
  }
}

import type { AlertBotConfig } from "../config.js";
import type { CheckResult } from "../types.js";

interface HealthResponse {
  status?: string;
  db?: string;
}

export class IndexerPoller {
  constructor(private readonly config: AlertBotConfig) {}

  async check(): Promise<CheckResult[]> {
    const url = `${this.config.indexerUrl}/health`;
    let resp: Response;
    try {
      resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    } catch (err) {
      return [
        {
          healthy: false,
          category: "indexer",
          summary: "Indexer unreachable",
          detail: `${(err as Error).message} (${url})`,
          severity: "critical",
        },
      ];
    }

    if (!resp.ok) {
      const body = await resp.json().catch(() => null) as HealthResponse | null;
      const statusText = body?.status ?? `HTTP ${resp.status}`;
      return [
        {
          healthy: false,
          category: "indexer",
          summary: "Indexer health degraded",
          detail: `Status: ${statusText} (${url})`,
          severity: resp.status >= 500 ? "critical" : "warning",
        },
      ];
    }

    return [
      {
        healthy: true,
        category: "indexer",
        summary: "Indexer healthy",
        severity: "info",
      },
    ];
  }
}

import * as fs from "fs";
import * as path from "path";

export interface TxMetric {
  txSignature: string;
  instruction: string;
  status: "success" | "error";
  errorCode?: string;
  errorMessage?: string;
  sendTimestamp: string;
  confirmTimestamp: string;
  latencyMs: number;
  computeUnits: number | null;
  slot: number | null;
}

export interface AggregateMetrics {
  scenario: string;
  concurrency: number;
  totalTransactions: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  avgComputeUnits: number | null;
  maxComputeUnits: number | null;
  tps: number;
  durationMs: number;
  startedAt: string;
  completedAt: string;
}

export class MetricsCollector {
  private entries: TxMetric[] = [];
  private startTime: number = Date.now();
  private scenario: string;
  private concurrency: number;

  constructor(scenario: string, concurrency: number) {
    this.scenario = scenario;
    this.concurrency = concurrency;
  }

  start(): void {
    this.startTime = Date.now();
  }

  record(entry: TxMetric): void {
    this.entries.push(entry);
  }

  async trackTx(
    instruction: string,
    sendFn: () => Promise<string>,
    confirmFn: (sig: string) => Promise<{ slot: number; computeUnits: number | null }>,
  ): Promise<TxMetric> {
    const sendTime = new Date();
    let metric: TxMetric;
    try {
      const sig = await sendFn();
      const result = await confirmFn(sig);
      const confirmTime = new Date();
      metric = {
        txSignature: sig,
        instruction,
        status: "success",
        sendTimestamp: sendTime.toISOString(),
        confirmTimestamp: confirmTime.toISOString(),
        latencyMs: confirmTime.getTime() - sendTime.getTime(),
        computeUnits: result.computeUnits,
        slot: result.slot,
      };
    } catch (err: any) {
      const confirmTime = new Date();
      const errorCode = err.code?.toString() ?? err.error?.errorCode?.code ?? undefined;
      metric = {
        txSignature: "",
        instruction,
        status: "error",
        errorCode,
        errorMessage: err.message?.slice(0, 200),
        sendTimestamp: sendTime.toISOString(),
        confirmTimestamp: confirmTime.toISOString(),
        latencyMs: confirmTime.getTime() - sendTime.getTime(),
        computeUnits: null,
        slot: null,
      };
    }
    this.entries.push(metric);
    return metric;
  }

  summarize(): AggregateMetrics {
    const endTime = Date.now();
    const successes = this.entries.filter((e) => e.status === "success");
    const latencies = successes.map((e) => e.latencyMs).sort((a, b) => a - b);
    const cus = successes
      .map((e) => e.computeUnits)
      .filter((c): c is number => c !== null);

    return {
      scenario: this.scenario,
      concurrency: this.concurrency,
      totalTransactions: this.entries.length,
      successCount: successes.length,
      errorCount: this.entries.length - successes.length,
      successRate: this.entries.length > 0 ? successes.length / this.entries.length : 0,
      avgLatencyMs: latencies.length > 0 ? mean(latencies) : 0,
      p50LatencyMs: percentile(latencies, 0.5),
      p95LatencyMs: percentile(latencies, 0.95),
      p99LatencyMs: percentile(latencies, 0.99),
      avgComputeUnits: cus.length > 0 ? mean(cus) : null,
      maxComputeUnits: cus.length > 0 ? Math.max(...cus) : null,
      tps:
        endTime - this.startTime > 0
          ? (successes.length / (endTime - this.startTime)) * 1000
          : 0,
      durationMs: endTime - this.startTime,
      startedAt: new Date(this.startTime).toISOString(),
      completedAt: new Date(endTime).toISOString(),
    };
  }

  writeResults(outputDir?: string): { dir: string; summary: AggregateMetrics } {
    const summary = this.summarize();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dir =
      outputDir ??
      path.join(
        __dirname,
        "..",
        "results",
        `${this.scenario}-${timestamp}`,
      );
    fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(
      path.join(dir, "metrics.json"),
      JSON.stringify(this.entries, null, 2),
    );
    fs.writeFileSync(
      path.join(dir, "summary.json"),
      JSON.stringify(summary, null, 2),
    );

    const csvHeader = Object.keys(summary).join(",");
    const csvRow = Object.values(summary)
      .map((v) => (v === null ? "" : String(v)))
      .join(",");
    fs.writeFileSync(path.join(dir, "summary.csv"), `${csvHeader}\n${csvRow}\n`);

    return { dir, summary };
  }

  getEntries(): readonly TxMetric[] {
    return this.entries;
  }
}

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

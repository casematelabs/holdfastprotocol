export type Severity = "critical" | "warning" | "info" | "recovery";

export interface CheckResult {
  healthy: boolean;
  category: string;
  summary: string;
  detail?: string;
  severity: Severity;
}

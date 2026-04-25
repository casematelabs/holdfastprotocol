import type { CheckResult, Severity } from "./types.js";
import type { DiscordWebhookSender } from "./discord.js";

interface AlertState {
  isFailing: boolean;
  lastAlertedAt: number;
}

export class AlertRouter {
  private readonly state = new Map<string, AlertState>();

  constructor(
    private readonly sender: DiscordWebhookSender,
    private readonly cooldownMs: number,
  ) {}

  async route(result: CheckResult): Promise<void> {
    const now = Date.now();
    const prev = this.state.get(result.category);

    if (result.healthy) {
      if (prev?.isFailing === true) {
        // Transition from failing → healthy: fire recovery alert
        this.state.set(result.category, { isFailing: false, lastAlertedAt: now });
        await this.sender.sendAlert(
          `✅ Recovered: ${result.summary}`,
          result.detail ?? "Check is passing again.",
          "recovery",
        );
      } else {
        this.state.set(result.category, {
          isFailing: false,
          lastAlertedAt: prev?.lastAlertedAt ?? 0,
        });
      }
      return;
    }

    // Failing: suppress if within cooldown for the same ongoing failure
    const withinCooldown =
      prev?.isFailing === true && now - prev.lastAlertedAt < this.cooldownMs;
    if (withinCooldown) return;

    this.state.set(result.category, { isFailing: true, lastAlertedAt: now });
    await this.sender.sendAlert(
      `${severityEmoji(result.severity)} ${result.summary}`,
      result.detail ?? result.summary,
      result.severity,
    );
  }
}

function severityEmoji(severity: Severity): string {
  switch (severity) {
    case "critical":
      return "🔴";
    case "warning":
      return "🟡";
    case "info":
      return "🔵";
    case "recovery":
      return "✅";
  }
}

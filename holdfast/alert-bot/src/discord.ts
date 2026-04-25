import type { Severity } from "./types.js";

const SEVERITY_COLORS: Record<Severity, number> = {
  critical: 0xff0000,
  warning: 0xffa500,
  info: 0x0099ff,
  recovery: 0x00aa00,
};

interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  timestamp?: string;
}

export class DiscordWebhookSender {
  constructor(private readonly webhookUrl: string) {}

  async sendAlert(
    title: string,
    description: string,
    severity: Severity,
    detail?: string,
  ): Promise<void> {
    const embed: DiscordEmbed = {
      title,
      description,
      color: SEVERITY_COLORS[severity],
      timestamp: new Date().toISOString(),
    };
    if (detail !== undefined) {
      embed.fields = [{ name: "Detail", value: detail.slice(0, 1024) }];
    }
    await this.postWithRetry({ embeds: [embed] });
  }

  private async postWithRetry(
    payload: { embeds: DiscordEmbed[] },
    maxAttempts = 3,
  ): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let response: Response;
      try {
        response = await fetch(this.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (err) {
        if (attempt >= maxAttempts) throw err;
        await sleep(backoffMs(attempt));
        continue;
      }

      // 204 No Content is the success response for Discord webhooks
      if (response.status === 204 || (response.status >= 200 && response.status < 300)) {
        return;
      }

      if (response.status === 429) {
        const retryAfterHeader = response.headers.get("Retry-After");
        const retryAfterSec = retryAfterHeader !== null ? parseFloat(retryAfterHeader) : 1;
        await sleep(Math.ceil(retryAfterSec * 1000));
        continue;
      }

      if (attempt >= maxAttempts) {
        const body = await response.text().catch(() => "");
        throw new Error(`Discord webhook returned ${response.status}: ${body}`);
      }
      await sleep(backoffMs(attempt));
    }
  }
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 10_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

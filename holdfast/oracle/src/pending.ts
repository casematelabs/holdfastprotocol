import type { DisputeEvent } from "./types.js";

// In-memory queue for disputes that have been detected but not yet submitted.
// For devnet single-node, submission is immediate, so the queue is drained on each handle.
// This exists to surface warnings for events that couldn't be submitted within voteTimeoutSeconds.
export class PendingQueue {
  private readonly queue = new Map<string, { event: DisputeEvent; deadline: number }>();

  constructor(private readonly voteTimeoutSeconds: number) {}

  add(event: DisputeEvent): void {
    const key = disputeKey(event);
    this.queue.set(key, { event, deadline: event.detectedAt + this.voteTimeoutSeconds });
  }

  remove(event: DisputeEvent): void {
    this.queue.delete(disputeKey(event));
  }

  // Log a warning for any disputes past their 72h vote deadline.
  checkDeadlines(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const [key, { event, deadline }] of this.queue) {
      if (now > deadline) {
        const hoursOver = Math.round((now - deadline) / 3600);
        console.warn(
          `[pending] MISSED VOTE DEADLINE: dispute ${key} (sig=${event.signature}) ` +
          `is ${hoursOver}h past its 72h window. Manual intervention required.`,
        );
      }
    }
  }

  size(): number {
    return this.queue.size;
  }
}

// Stable key for a dispute: pactId + agent + counterparty.
function disputeKey(event: DisputeEvent): string {
  return `${event.pactId.toString("hex")}:${event.agentPubkey}:${event.counterpartyPubkey}`;
}

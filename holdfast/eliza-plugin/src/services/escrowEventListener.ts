import type { IAgentRuntime } from "@elizaos/core";
import type { HoldfastClient } from "@holdfastprotocol/sdk";
import { EscrowStatus } from "@holdfastprotocol/sdk";
import { PublicKey } from "@solana/web3.js";

const POLL_INTERVAL_MS = 30_000;
const MAX_CONSECUTIVE_FAILURES = 5;
const RECONNECT_BASE_MS = 2_000;
const MAX_RECONNECT_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class EscrowEventListenerService {
  static serviceType = "holdfast-protocol-escrow-listener";

  private timer: ReturnType<typeof setInterval> | null = null;
  private agentPubkey: PublicKey | null = null;
  private consecutiveFailures = 0;
  private lastSeenState = new Map<string, EscrowStatus>();

  constructor(
    private readonly client: HoldfastClient,
    private readonly runtime: IAgentRuntime,
    agentWalletBase58?: string,
  ) {
    if (agentWalletBase58) {
      this.agentPubkey = new PublicKey(agentWalletBase58);
    }
  }

  async start(): Promise<void> {
    if (!this.agentPubkey) return;
    this.startPoller();
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private startPoller(): void {
    this.consecutiveFailures = 0;
    this.timer = setInterval(() => {
      void this.tick();
    }, POLL_INTERVAL_MS);
  }

  private async tick(): Promise<void> {
    try {
      await this.fetchAndEmit();
      this.consecutiveFailures = 0;
    } catch (err) {
      this.consecutiveFailures++;
      console.warn(
        `[Holdfast] Listener poll failure ${this.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}: ${(err as Error).message}`,
      );
      if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        clearInterval(this.timer!);
        this.timer = null;
        console.warn("[Holdfast] Listener: polling suspended, starting reconnect sequence.");
        void this.reconnect(1);
      }
    }
  }

  private async reconnect(attempt: number): Promise<void> {
    if (attempt > MAX_RECONNECT_ATTEMPTS) {
      console.error("[Holdfast] Listener: max reconnect attempts reached. Service stopped.");
      return;
    }
    const delayMs = Math.min(RECONNECT_BASE_MS * 2 ** (attempt - 1), MAX_RECONNECT_MS);
    console.warn(
      `[Holdfast] Listener: reconnect attempt ${attempt}/${MAX_RECONNECT_ATTEMPTS} in ${delayMs}ms.`,
    );
    await sleep(delayMs);
    try {
      await this.fetchAndEmit();
      console.info("[Holdfast] Listener: reconnected successfully. Resuming polling.");
      this.startPoller();
    } catch (err) {
      console.warn(`[Holdfast] Listener: reconnect attempt ${attempt} failed: ${(err as Error).message}`);
      await this.reconnect(attempt + 1);
    }
  }

  private async fetchAndEmit(): Promise<void> {
    if (!this.agentPubkey) return;
    const page = await this.client.escrow.listPacts(this.agentPubkey, {
      status: EscrowStatus.Funded,
    });
    const currentIds = new Set<string>();
    for (const pact of page.pacts) {
      currentIds.add(pact.escrowId);
      if (this.lastSeenState.get(pact.escrowId) !== pact.status) {
        await (this.runtime.emitEvent as (event: string, params: unknown) => Promise<void>)(
          "HOLDFAST_PACT_STATE",
          { pact },
        );
        this.lastSeenState.set(pact.escrowId, pact.status);
      }
    }
    for (const id of this.lastSeenState.keys()) {
      if (!currentIds.has(id)) {
        this.lastSeenState.delete(id);
      }
    }
  }
}

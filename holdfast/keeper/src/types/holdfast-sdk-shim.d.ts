import type { Keypair, PublicKey } from "@solana/web3.js";

declare module "@holdfastprotocol/sdk" {
  export interface HoldfastClientConfig {
    rpcUrl: string;
    signer: Keypair;
    escrowProgramId?: PublicKey;
    holdfastProgramId?: PublicKey;
  }

  export interface AutoReleaseCandidate {
    escrowId: PublicKey;
    escrowAddress: PublicKey;
    timeLockExpiresAt: number;
    isExpired: boolean;
  }

  export interface HoldfastEscrowClient {
    listAutoReleaseCandidates(opts: {
      nowUnixSecs: number;
      lookaheadSecs: number;
      limit: number;
    }): Promise<AutoReleaseCandidate[]>;
    autoRelease(escrowId: PublicKey): Promise<string>;
  }

  export interface HoldfastClient {
    escrow: HoldfastEscrowClient;
  }

  export function createHoldfastClient(config: HoldfastClientConfig): HoldfastClient;
}

export {};

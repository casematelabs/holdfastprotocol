import manifest from '../release-manifest.json';

export interface ReleaseManifest {
  release: {
    channel: string;
    network: string;
    sdk: {
      package: string;
      version: string;
    };
  };
  endpoints: {
    rpc: string;
    indexerBase: string;
    indexerApiPath: string;
  };
  programs: {
    holdfast: string;
    holdfastEscrow: string;
  };
  explorer: {
    baseUrl: string;
    cluster: string;
  };
}

export const releaseManifest: ReleaseManifest = manifest;

export const DEVNET_RPC_URL = releaseManifest.endpoints.rpc;
export const DEVNET_INDEXER_BASE = `${releaseManifest.endpoints.indexerBase}${releaseManifest.endpoints.indexerApiPath}`;

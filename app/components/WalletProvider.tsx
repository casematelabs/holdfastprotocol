'use client';

import { useMemo } from 'react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';
import { useNotifications } from './NotificationContext';

const NETWORK = (process.env.NEXT_PUBLIC_SOLANA_NETWORK as WalletAdapterNetwork | undefined) ?? WalletAdapterNetwork.Devnet;

export function SolanaWalletProvider({ children }: { children: React.ReactNode }) {
  const { push } = useNotifications();
  const endpoint = useMemo(() => clusterApiUrl(NETWORK), []);
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider
        wallets={wallets}
        autoConnect={false}
        onError={(error) => {
          console.error('[wallet]', error);
          push({
            category: 'pact',
            severity: 'warning',
            title: 'Wallet error',
            body: error.message || 'An unexpected wallet error occurred.',
          });
        }}
      >
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}

'use client';

import { ReactNode, useState } from 'react';
import { createAppKit } from '@reown/appkit/react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { REOWN_NETWORKS, REOWN_PROJECT_ID, wagmiAdapter, wagmiConfig } from '@/config/reown';

const metadata = {
  name: 'BAEVII',
  description: 'Create and manage tokenized-stock ITFs on Base',
  url: typeof window !== 'undefined' ? window.location.origin : 'https://baevii.vercel.app',
  icons: [typeof window !== 'undefined' ? `${window.location.origin}/baevii-logo.png` : '/baevii-logo.png'],
};

// Created once at module load (client only), as Reown recommends
createAppKit({
  adapters: [wagmiAdapter],
  projectId: REOWN_PROJECT_ID,
  networks: REOWN_NETWORKS,
  defaultNetwork: REOWN_NETWORKS[0],
  metadata,
  features: {
    analytics: true,
    email: true,
    socials: ['google', 'x', 'discord', 'github', 'apple'],
  },
  themeVariables: {
    '--w3m-accent': '#2563eb',
  },
});

export function ReownProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}

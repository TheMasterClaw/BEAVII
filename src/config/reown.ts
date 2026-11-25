import { cookieStorage, createStorage } from 'wagmi';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { baseSepolia, type AppKitNetwork } from '@reown/appkit/networks';

/** Reown (WalletConnect) Cloud project ID: https://dashboard.reown.com */
export const REOWN_PROJECT_ID = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? '';

if (!REOWN_PROJECT_ID && typeof window !== 'undefined') {
  console.warn('NEXT_PUBLIC_REOWN_PROJECT_ID is not set. Add it to .env.local.');
}

// Base-only app: tokenized stocks live on Base Sepolia
export const REOWN_NETWORKS: [AppKitNetwork, ...AppKitNetwork[]] = [baseSepolia];

export const wagmiAdapter = new WagmiAdapter({
  storage: createStorage({ storage: cookieStorage }),
  ssr: true,
  projectId: REOWN_PROJECT_ID,
  networks: REOWN_NETWORKS,
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;

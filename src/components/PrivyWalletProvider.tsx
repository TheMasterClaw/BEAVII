'use client';

import { ReactNode, useEffect, useState } from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { PrivyWalletsWrapper } from './PrivyWalletsWrapper';
import { BASE_SEPOLIA } from '@/config/base-sepolia';

const baseSepolia = {
  id: BASE_SEPOLIA.chainId,
  name: BASE_SEPOLIA.name,
  network: 'base-sepolia',
  nativeCurrency: BASE_SEPOLIA.nativeCurrency,
  rpcUrls: {
    default: { http: [BASE_SEPOLIA.rpcUrl] },
    public: { http: ['https://sepolia.base.org'] },
  },
  blockExplorers: { default: { name: 'Basescan', url: BASE_SEPOLIA.blockExplorer } },
  testnet: true,
};

interface PrivyWalletProviderProps {
  children: ReactNode;
}

export function PrivyWalletProvider({ children }: PrivyWalletProviderProps) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const [appUrl, setAppUrl] = useState<string>('');

  // Get the current URL for WalletConnect metadata
  useEffect(() => {
    // Get the base URL (protocol + hostname)
    const baseUrl = window.location.origin;
    setAppUrl(baseUrl);
  }, []);

  if (!appId) {
    console.warn('NEXT_PUBLIC_PRIVY_APP_ID is not set. Please add it to your .env.local file.');
    // Return children without Privy provider if no app ID is set
    return <>{children}</>;
  }

  // Only render the provider once we have the URL
  if (!appUrl && typeof window !== 'undefined') {
    return <>{children}</>;
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        // Appearance configuration
        appearance: {
          theme: 'light',
          accentColor: '#2563eb', // Blue accent color matching the UI
          logo: '/baevii-logo.png',
          showWalletLoginFirst: true,
          // Configure wallet list to avoid conflicts
          walletList: ['wallet_connect', 'rainbow'],
        },
        // Login methods - allowing both email/social and wallet connections
        loginMethods: ['email', 'wallet', 'google', 'twitter'],
        // Embedded wallet config
        embeddedWallets: {
          createOnLogin: 'users-without-wallets', // Create embedded wallet for users without external wallet
        },
        // Updated WalletConnect project ID (get new one from https://cloud.walletconnect.com)
        walletConnectCloudProjectId: '34357d3c125c2bcf2ce2bc3309d98715',
        // External wallet configuration - disable Coinbase Smart Wallet
        externalWallets: {
          coinbaseWallet: {
            connectionOptions: 'eoaOnly', // Use EOA only to avoid smart wallet conflicts
          },
        },
        // Base Sepolia is the primary (and only) chain: tokenized stocks live there
        defaultChain: baseSepolia,
        supportedChains: [baseSepolia],
      }}
    >
      <PrivyWalletsWrapper>
        {children}
      </PrivyWalletsWrapper>
    </PrivyProvider>
  );
}

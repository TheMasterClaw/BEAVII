'use client';

import { useAppKit } from '@reown/appkit/react';
import { useConnection, useDisconnect } from 'wagmi';

/** Login state backed by Reown AppKit (wallet, email or social login). */
export function useWalletAuth() {
  const { open } = useAppKit();
  const { address, chainId, status } = useConnection();
  const { mutate: disconnect } = useDisconnect();

  return {
    isAuthenticated: status === 'connected' && Boolean(address),
    isLoading: status === 'connecting' || status === 'reconnecting',
    user: address ? { address, chainId } : null,
    connectWallet: () => open(),
    openAccount: () => open({ view: 'Account' }),
    disconnect: () => disconnect(),
  };
}

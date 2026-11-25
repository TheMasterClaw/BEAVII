'use client';

import { Wallet, CheckCircle } from 'lucide-react';
import { Button } from './ui/button';
import { useWalletAuth } from '@/hooks/use-wallet-auth';

/** Reown AppKit login: opens the wallet / email / social modal. */
export const WalletConnectButton = () => {
  const { isAuthenticated, isLoading, user, connectWallet, openAccount } = useWalletAuth();

  if (isAuthenticated && user) {
    return (
      <Button variant="outline" size="sm" onClick={openAccount} className="gap-2 font-mono">
        <CheckCircle className="w-4 h-4 text-green-500" />
        <span className="hidden min-[400px]:inline">{user.address.slice(0, 6)}…</span>{user.address.slice(-4)}
      </Button>
    );
  }

  return (
    <Button size="sm" onClick={connectWallet} disabled={isLoading} className="gap-2">
      <Wallet className="w-4 h-4" />
      {isLoading ? 'Connecting…' : 'Log in'}
    </Button>
  );
};

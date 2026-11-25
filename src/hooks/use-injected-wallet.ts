'use client';

import { useCallback } from 'react';
import { ethers } from 'ethers';
import { useAppKit } from '@reown/appkit/react';
import { useConnection, useSwitchChain } from 'wagmi';
import { getConnectorClient } from 'wagmi/actions';
import { BASE_SEPOLIA_CHAIN_ID } from '@/config/base-sepolia';
import { wagmiConfig } from '@/config/reown';

/**
 * Account connected through Reown AppKit (any wallet, email or social login) on Base Sepolia,
 * with connect / switch-network and an ethers signer getter.
 */
export function useInjectedWallet() {
  const { open } = useAppKit();
  const { address, chainId: connectedChainId } = useConnection();
  const { mutateAsync: switchChain } = useSwitchChain();

  const account = address ? address.toLowerCase() : '';
  const chainId = address ? connectedChainId ?? null : null;

  const ensureBaseSepolia = useCallback(async () => {
    if (!address) throw new Error('Log in first.');
    if (connectedChainId !== BASE_SEPOLIA_CHAIN_ID) await switchChain({ chainId: BASE_SEPOLIA_CHAIN_ID });
  }, [address, connectedChainId, switchChain]);

  const connect = useCallback(async () => {
    await open();
  }, [open]);

  const getSigner = useCallback(async () => {
    await ensureBaseSepolia();
    const client = await getConnectorClient(wagmiConfig, { chainId: BASE_SEPOLIA_CHAIN_ID });
    const provider = new ethers.BrowserProvider(client.transport as ethers.Eip1193Provider, {
      chainId: BASE_SEPOLIA_CHAIN_ID,
      name: 'base-sepolia',
    });
    return provider.getSigner(client.account.address);
  }, [ensureBaseSepolia]);

  const wrongChain = Boolean(account && chainId !== null && chainId !== BASE_SEPOLIA_CHAIN_ID);
  return { account, chainId, wrongChain, connect, ensureBaseSepolia, getSigner };
}

/** Short, human-readable message from an ethers / wallet error. */
export function txErrorMessage(e: unknown) {
  const err = e as {
    reason?: string;
    shortMessage?: string;
    message?: string;
    revert?: { name?: string };
    info?: { error?: { message?: string } };
  };
  const name = err.revert?.name;
  if (name && CONTRACT_ERRORS[name]) return CONTRACT_ERRORS[name];
  if (name) return name;
  return err.reason ?? err.shortMessage ?? err.info?.error?.message ?? err.message ?? 'Transaction failed';
}

const CONTRACT_ERRORS: Record<string, string> = {
  StalePrice: 'A stock price in this ITF is out of date. The protocol agent refreshes prices on a schedule; try again later, or redeem in kind now.',
  BadWeights: 'Weights must add up to exactly 100%.',
  FeeTooHigh: 'A fee is above the limit (5%/yr management, 1% entry, 1% exit).',
  FeesNotReady: 'The fee change is still in its 3-day waiting period.',
  UnsupportedToken: 'One of the stocks is not listed on the exchange.',
  TooManyAssets: 'An ITF can hold at most 20 stocks.',
  BadName: 'Name must be 1–64 characters and symbol 1–12 characters.',
  Slippage: 'The price moved past your minimum. Try again.',
  NotAgent: 'Only the manager or an authorized agent can do this.',
  OwnableUnauthorizedAccount: 'Only the ITF manager can do this.',
  EnforcedPause: 'This ITF is paused. You can still redeem in kind.',
  ZeroAmount: 'Amount is too small.',
};

'use client';

import { useCallback, useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { BASE_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID_HEX, BASE_SEPOLIA_WALLET_PARAMS } from '@/config/base-sepolia';

type Eip1193 = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (e: string, cb: (...a: unknown[]) => void) => void;
  removeListener?: (e: string, cb: (...a: unknown[]) => void) => void;
};

function getInjected(): Eip1193 | null {
  return typeof window !== 'undefined' ? ((window as unknown as { ethereum?: Eip1193 }).ethereum ?? null) : null;
}

/** Browser-wallet (EIP-1193) account on Base Sepolia, with connect / switch-network and a signer getter. */
export function useInjectedWallet() {
  const [account, setAccount] = useState('');
  const [chainId, setChainId] = useState<number | null>(null);

  useEffect(() => {
    const eth = getInjected();
    if (!eth) return;
    eth.request({ method: 'eth_accounts' }).then((a) => setAccount(((a as string[])[0] ?? '').toLowerCase())).catch(() => {});
    eth.request({ method: 'eth_chainId' }).then((c) => setChainId(parseInt(c as string, 16))).catch(() => {});
    const onAccounts = (a: unknown) => setAccount((((a as string[]) ?? [])[0] ?? '').toLowerCase());
    const onChain = (c: unknown) => setChainId(parseInt(c as string, 16));
    eth.on?.('accountsChanged', onAccounts);
    eth.on?.('chainChanged', onChain);
    return () => {
      eth.removeListener?.('accountsChanged', onAccounts);
      eth.removeListener?.('chainChanged', onChain);
    };
  }, []);

  const ensureBaseSepolia = useCallback(async () => {
    const eth = getInjected();
    if (!eth) throw new Error('No browser wallet found. Install Coinbase Wallet or MetaMask.');
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BASE_SEPOLIA_CHAIN_ID_HEX }] });
    } catch (e) {
      if ((e as { code?: number }).code === 4902) {
        await eth.request({ method: 'wallet_addEthereumChain', params: [BASE_SEPOLIA_WALLET_PARAMS] });
      } else throw e;
    }
    setChainId(BASE_SEPOLIA_CHAIN_ID);
    return eth;
  }, []);

  const connect = useCallback(async () => {
    const eth = getInjected();
    if (!eth) throw new Error('No browser wallet found. Install Coinbase Wallet or MetaMask.');
    const accts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
    setAccount(accts[0].toLowerCase());
    await ensureBaseSepolia();
  }, [ensureBaseSepolia]);

  const getSigner = useCallback(async () => {
    const eth = await ensureBaseSepolia();
    return new ethers.BrowserProvider(eth as ethers.Eip1193Provider).getSigner();
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
  StalePrice: 'A stock price is missing or out of date. Sync prices, then try again.',
  BadWeights: 'Weights must add up to exactly 100%.',
  FeeTooHigh: 'A fee is above the limit (5%/yr management, 1% entry, 1% exit).',
  FeesNotReady: 'The fee change is still in its 3-day waiting period.',
  UnsupportedToken: 'One of the stocks is not listed on the exchange.',
  TooManyAssets: 'An ETF can hold at most 20 stocks.',
  BadName: 'Name must be 1–64 characters and symbol 1–12 characters.',
  Slippage: 'The price moved past your minimum. Try again.',
  NotAgent: 'Only the manager or an authorized agent can do this.',
  OwnableUnauthorizedAccount: 'Only the ETF manager can do this.',
  EnforcedPause: 'This ETF is paused. You can still redeem in kind.',
  ZeroAmount: 'Amount is too small.',
};

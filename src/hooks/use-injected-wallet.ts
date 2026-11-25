'use client';

import { useCallback } from 'react';
import type { Abi, Address, Hex, TransactionReceipt } from 'viem';
import { useAppKit } from '@reown/appkit/react';
import { useConnection, useSwitchChain } from 'wagmi';
import {
  readContract,
  sendTransaction,
  signMessage as signWalletMessage,
  simulateContract,
  waitForTransactionReceipt,
  writeContract,
} from 'wagmi/actions';
import { BASE_SEPOLIA_CHAIN_ID } from '@/config/base-sepolia';
import { wagmiConfig } from '@/config/reown';

export interface ContractCall {
  address: string;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
}

const chainId = BASE_SEPOLIA_CHAIN_ID;

/** Wait for a mined transaction; like ethers' tx.wait(), a reverted transaction throws. */
async function confirm(hash: Hex): Promise<TransactionReceipt> {
  const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId });
  if (receipt.status !== 'success') throw new Error(`Transaction ${hash} reverted`);
  return receipt;
}

/**
 * Account connected through Reown AppKit (any wallet, email or social login) on Base Sepolia,
 * with connect / switch-network and viem-based contract read / write helpers (no ethers in the browser).
 */
export function useInjectedWallet() {
  const { open } = useAppKit();
  const { address, chainId: connectedChainId } = useConnection();
  const { mutateAsync: switchChain } = useSwitchChain();

  const account = address ? address.toLowerCase() : '';
  const currentChainId = address ? connectedChainId ?? null : null;

  const ensureBaseSepolia = useCallback(async () => {
    if (!address) throw new Error('Log in first.');
    if (connectedChainId !== BASE_SEPOLIA_CHAIN_ID) await switchChain({ chainId: BASE_SEPOLIA_CHAIN_ID });
    return address;
  }, [address, connectedChainId, switchChain]);

  const connect = useCallback(async () => {
    await open();
  }, [open]);

  /** View call on Base Sepolia. */
  const read = useCallback(
    <T = unknown>(call: ContractCall) =>
      readContract(wagmiConfig, { ...call, address: call.address as Address, chainId } as never) as Promise<T>,
    [],
  );

  /**
   * Simulate, send and wait for a contract write. Simulating first surfaces decoded custom errors
   * (StalePrice, BadWeights, ...) before the wallet prompt, as ethers' gas estimation did.
   */
  const write = useCallback(
    async (call: ContractCall & { value?: bigint }) => {
      const from = await ensureBaseSepolia();
      const { request } = await simulateContract(wagmiConfig, {
        ...call,
        address: call.address as Address,
        account: from,
        chainId,
      } as never);
      return confirm(await writeContract(wagmiConfig, request as never));
    },
    [ensureBaseSepolia],
  );

  /** Send native ETH and wait for it to be mined. */
  const sendEth = useCallback(
    async (to: string, value: bigint) => {
      await ensureBaseSepolia();
      return confirm(await sendTransaction(wagmiConfig, { to: to as Address, value, chainId }));
    },
    [ensureBaseSepolia],
  );

  /** EIP-191 personal_sign from the connected account. */
  const signMessage = useCallback(
    async (message: string) => {
      const from = await ensureBaseSepolia();
      return signWalletMessage(wagmiConfig, { account: from, message });
    },
    [ensureBaseSepolia],
  );

  const wrongChain = Boolean(account && currentChainId !== null && currentChainId !== BASE_SEPOLIA_CHAIN_ID);
  return { account, chainId: currentChainId, wrongChain, connect, ensureBaseSepolia, read, write, sendEth, signMessage };
}

type WalkableError = { name?: string; data?: { errorName?: string } };

/** Short, human-readable message from a viem / ethers / wallet error. */
export function txErrorMessage(e: unknown) {
  const err = e as {
    reason?: string;
    shortMessage?: string;
    message?: string;
    revert?: { name?: string };
    info?: { error?: { message?: string } };
    walk?: (fn: (e: unknown) => boolean) => unknown;
  };
  // viem wraps a decoded custom error in ContractFunctionRevertedError somewhere down the cause chain
  const reverted = err.walk?.((c) => (c as WalkableError)?.name === 'ContractFunctionRevertedError') as WalkableError | undefined;
  const name = err.revert?.name ?? reverted?.data?.errorName;
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

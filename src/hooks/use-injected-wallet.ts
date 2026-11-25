'use client';

import { useCallback } from 'react';
import { ethers } from 'ethers';
import { useAppKit } from '@reown/appkit/react';
import { useConnection, useSwitchChain } from 'wagmi';
import { getConnectorClient } from 'wagmi/actions';
import { CHAIN_ID, NETWORK } from '@/config/network';
import FactoryJSON from '@/lib/abis/ETFFactory.json';
import VaultJSON from '@/lib/abis/StockBasketVault.json';
import OracleJSON from '@/lib/abis/PriceOracle.json';
import ExchangeJSON from '@/lib/abis/StockExchange.json';
import VenueJSON from '@/lib/abis/UniswapV3Venue.json';
import { wagmiConfig } from '@/config/reown';

/**
 * Account connected through Reown AppKit (any wallet, email or social login) on the configured Base network,
 * with connect / switch-network and an ethers signer getter.
 */
export function useInjectedWallet() {
  const { open } = useAppKit();
  const { address, chainId: connectedChainId } = useConnection();
  const { mutateAsync: switchChain } = useSwitchChain();

  const account = address ? address.toLowerCase() : '';
  const chainId = address ? connectedChainId ?? null : null;

  const ensureNetwork = useCallback(async () => {
    if (!address) throw new Error('Log in first.');
    if (connectedChainId !== CHAIN_ID) await switchChain({ chainId: CHAIN_ID });
  }, [address, connectedChainId, switchChain]);

  const connect = useCallback(async () => {
    await open();
  }, [open]);

  const getSigner = useCallback(async () => {
    await ensureNetwork();
    const client = await getConnectorClient(wagmiConfig, { chainId: CHAIN_ID });
    const provider = new ethers.BrowserProvider(client.transport as ethers.Eip1193Provider, {
      chainId: CHAIN_ID,
      name: NETWORK.key,
    });
    return provider.getSigner(client.account.address);
  }, [ensureNetwork]);

  const wrongChain = Boolean(account && chainId !== null && chainId !== CHAIN_ID);
  return { account, chainId, wrongChain, connect, ensureNetwork, getSigner };
}

/** Every custom error the protocol contracts can revert with, so nested reverts (e.g. an oracle error inside
 *  a vault call) decode to a name instead of raw hex. */
const PROTOCOL_ERRORS = new ethers.Interface(
  [FactoryJSON, VaultJSON, OracleJSON, ExchangeJSON, VenueJSON].flatMap((j) =>
    (j.abi as { type: string }[]).filter((f) => f.type === 'error'),
  ) as ethers.InterfaceAbi,
);

function revertName(err: { revert?: { name?: string }; data?: string; info?: { error?: { data?: string } } }) {
  if (err.revert?.name) return err.revert.name;
  const data = err.data ?? err.info?.error?.data;
  if (typeof data !== 'string' || data.length < 10) return undefined;
  try {
    return PROTOCOL_ERRORS.parseError(data)?.name;
  } catch {
    return undefined;
  }
}

/** Short, human-readable message from an ethers / wallet error. */
export function txErrorMessage(e: unknown) {
  const err = e as {
    reason?: string;
    shortMessage?: string;
    message?: string;
    data?: string;
    revert?: { name?: string };
    info?: { error?: { message?: string; data?: string } };
  };
  const name = revertName(err);
  if (name && CONTRACT_ERRORS[name]) return CONTRACT_ERRORS[name];
  if (name) return name;
  return err.reason ?? err.shortMessage ?? err.info?.error?.message ?? err.message ?? 'Transaction failed';
}

const CONTRACT_ERRORS: Record<string, string> = {
  StalePrice: 'A stock price is missing or out of date, so pricing is paused. You can still redeem in kind.',
  SequencerDown: 'The Base sequencer recently went down, so pricing is paused for safety. Try again shortly.',
  BadWeights: 'Weights must add up to exactly 100%, and every stock needs a weight above 0.',
  DuplicateAsset: 'A stock appears twice in the basket.',
  FeeTooHigh: 'A fee is above the limit (5%/yr management, 1% entry, 1% exit).',
  FeesNotReady: 'The fee change is still in its 3-day waiting period.',
  BasketNotReady: 'The basket change is still in its 24-hour waiting period.',
  UnsupportedToken: 'One of the stocks is not listed on the price oracle.',
  TooManyAssets: 'An ETF can hold at most 20 stocks.',
  BadName: 'Name must be 1–64 characters and symbol 1–12 characters.',
  Slippage: 'The trade would fill worse than allowed (your minimum, or the protocol slippage cap). Try again.',
  NotAgent: 'Only the manager or an authorized agent can do this.',
  RebalanceTooSoon: 'This ETF was rebalanced less than 12 hours ago.',
  TvlCapExceeded: 'This deposit would take the ETF past its launch size cap.',
  Sanctioned: 'This address is not permitted to use the protocol.',
  NotApprovedManager: 'ETF launches are currently limited to approved managers.',
  ZeroNav: 'This ETF has no priced holdings, so new shares cannot be valued.',
  NoPool: 'No trading pool is configured for one of the stocks.',
  OwnableUnauthorizedAccount: 'Only the ETF manager can do this.',
  EnforcedPause: 'This ETF is paused. You can still redeem in kind.',
  ZeroAmount: 'Amount is too small.',
};

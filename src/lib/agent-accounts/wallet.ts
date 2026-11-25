/**
 * Server-only: each agent account has its own wallet. Its key is derived as
 * HMAC-SHA256(AGENT_WALLET_SEED, "beavii-agent-wallet:v1:<agentId>"), so no private key is ever stored.
 * Losing the seed loses every agent wallet, and leaking it exposes them all; keep it out of git and backed up.
 */
import { createHmac } from 'node:crypto';
import { ethers } from 'ethers';
import { getBaseSepoliaProvider, getStockAgentSigner } from '@/lib/stock-vault';

function seed() {
  const s = process.env.AGENT_WALLET_SEED ?? '';
  if (!/^(0x)?[0-9a-fA-F]{64,}$/.test(s)) {
    throw new Error('AGENT_WALLET_SEED is not set: generate one with `openssl rand -hex 32` and keep it secret');
  }
  return Buffer.from(s.replace(/^0x/, ''), 'hex');
}

export function agentWallet(agentId: string) {
  if (typeof window !== 'undefined') throw new Error('agentWallet is server-only');
  const pk = '0x' + createHmac('sha256', seed()).update(`beavii-agent-wallet:v1:${agentId}`).digest('hex');
  return new ethers.Wallet(pk, getBaseSepoliaProvider());
}

/** One in-flight transaction sequence per agent wallet, so nonces never collide within this server. */
const locks = new Map<string, Promise<unknown>>();
export function withAgentLock<T>(address: string, fn: () => Promise<T>): Promise<T> {
  const key = address.toLowerCase();
  const run = (locks.get(key) ?? Promise.resolve()).then(fn, fn);
  locks.set(key, run.catch(() => undefined));
  return run;
}

// ---------------------------------------------------------------- testnet gas sponsorship
const MIN_GAS = ethers.parseEther(process.env.AGENT_GAS_MIN_ETH || '0.0003');
const TOP_UP = ethers.parseEther(process.env.AGENT_GAS_TOPUP_ETH || '0.001');
const TOPUP_COOLDOWN_MS = 10 * 60 * 1000;
const lastTopUp = new Map<string, number>();

/**
 * Make sure the agent wallet can pay gas. On testnet the protocol key tops it up (at most once per 10 min);
 * set AGENT_GAS_SPONSOR=off to require owners to send ETH themselves.
 */
export async function ensureGas(address: string) {
  const provider = getBaseSepoliaProvider();
  const balance = await provider.getBalance(address);
  if (balance >= MIN_GAS) return null;
  if (process.env.AGENT_GAS_SPONSOR === 'off') {
    throw new Error(`agent wallet ${address} needs Base Sepolia ETH for gas (has ${ethers.formatEther(balance)})`);
  }
  const last = lastTopUp.get(address) ?? 0;
  if (Date.now() - last < TOPUP_COOLDOWN_MS) {
    throw new Error(`agent wallet is out of gas and was topped up recently; ask the owner to send Base Sepolia ETH to ${address}`);
  }
  lastTopUp.set(address, Date.now());
  const tx = await getStockAgentSigner().sendTransaction({ to: address, value: TOP_UP });
  await tx.wait();
  return tx.hash;
}

import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { CASH_TOKEN, findStock } from '@/config/base-sepolia';
import { fetchAllStockPrices } from '@/lib/stock-prices';
import { getB20, getBaseSepoliaProvider, getStockAgentSigner } from '@/lib/stock-vault';
import { withAgentSigner } from '@/lib/stock-agent';

export const dynamic = 'force-dynamic';

const CASH_DRIP = 1_000; // tUSDC per claim
const STOCK_DRIP_USD = 250; // optional single-stock drip, USD value at NAV
const COOLDOWN_MS = 6 * 60 * 60 * 1000;
const HOURLY_CAP = 60; // claims per hour per server instance
// Keep enough gas for the price agent: the faucet shares its key and must never starve price syncs.
const MIN_AGENT_BALANCE = ethers.parseEther('0.003');

// Per-instance state. Serverless instances don't share it; a KV store would make these limits global.
const lastByAddress = new Map<string, number>();
const lastByIp = new Map<string, number>();
const recentClaims: number[] = [];

function clientIp(req: NextRequest) {
  // On Vercel the first x-forwarded-for hop is the client, set by the edge.
  return req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

function prune(now: number) {
  while (recentClaims.length && now - recentClaims[0] > 60 * 60 * 1000) recentClaims.shift();
  if (lastByAddress.size + lastByIp.size > 20_000) {
    for (const m of [lastByAddress, lastByIp]) for (const [k, t] of m) if (now - t > COOLDOWN_MS) m.delete(k);
  }
}

/**
 * POST /api/stocks/faucet { address, stock?: "TSLAc" }
 * Mints 1,000 tUSDC (and optionally ~$250 of any of the 415 test stocks) on Base Sepolia.
 * Limits: one claim per address and per IP every 6h, HOURLY_CAP claims/hour, and a gas floor on the agent key.
 */
export async function POST(req: NextRequest) {
  if (!CASH_TOKEN.address) return NextResponse.json({ error: 'tUSDC is not deployed yet' }, { status: 503 });
  const { address, stock } = (await req.json().catch(() => ({}))) as { address?: string; stock?: string };
  if (!address || !ethers.isAddress(address)) return NextResponse.json({ error: 'valid address required' }, { status: 400 });
  const target = stock ? findStock(stock) : undefined;
  if (stock && !target?.address) return NextResponse.json({ error: `unknown stock ${stock}` }, { status: 400 });

  const now = Date.now();
  prune(now);
  const key = address.toLowerCase();
  const ip = clientIp(req);
  const last = Math.max(lastByAddress.get(key) ?? 0, lastByIp.get(ip) ?? 0);
  if (now - last < COOLDOWN_MS) {
    return NextResponse.json({ error: 'Faucet cooldown, try again later', retryAt: new Date(last + COOLDOWN_MS).toISOString() }, { status: 429 });
  }
  if (recentClaims.length >= HOURLY_CAP) {
    return NextResponse.json({ error: 'Faucet is busy, try again in a few minutes' }, { status: 429 });
  }
  lastByAddress.set(key, now);
  lastByIp.set(ip, now);
  recentClaims.push(now);
  const release = () => {
    lastByAddress.delete(key);
    lastByIp.delete(ip);
    const i = recentClaims.indexOf(now);
    if (i >= 0) recentClaims.splice(i, 1);
  };

  try {
    const signer = getStockAgentSigner();
    if ((await getBaseSepoliaProvider().getBalance(signer.address)) < MIN_AGENT_BALANCE) {
      release();
      return NextResponse.json({ error: 'Faucet is temporarily out of gas' }, { status: 503 });
    }
    const unitPrice = target ? (await fetchAllStockPrices().then((r) => r.prices[target.symbol]?.price).catch(() => null)) ?? target.priceUsd ?? target.navPrice : null;
    const txHashes = await withAgentSigner(async () => {
      const nonce = await signer.getNonce('pending');
      const txs = [await getB20(CASH_TOKEN.address, signer).mint(address, ethers.parseUnits(String(CASH_DRIP), CASH_TOKEN.decimals), { nonce })];
      if (target && unitPrice) {
        const units = (STOCK_DRIP_USD / unitPrice).toFixed(target.decimals);
        txs.push(await getB20(target.address, signer).mint(address, ethers.parseUnits(units, target.decimals), { nonce: nonce + 1 }));
      }
      await Promise.all(txs.map((t) => t.wait()));
      return txs.map((t) => t.hash as string);
    });
    return NextResponse.json({ ok: true, cash: CASH_DRIP, stock: target?.symbol ?? null, txHashes });
  } catch (e) {
    release();
    console.error('faucet failed', e);
    return NextResponse.json({ error: 'Faucet failed, try again later' }, { status: 500 });
  }
}

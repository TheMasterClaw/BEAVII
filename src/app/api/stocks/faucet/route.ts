import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { CASH_TOKEN, IS_TESTNET, findStock } from '@/config/network';
import { fetchAllStockPrices } from '@/lib/stock-prices';
import { getB20, getStockAgentSigner } from '@/lib/stock-vault';

export const dynamic = 'force-dynamic';

const CASH_DRIP = 1_000; // tUSDC per claim
const STOCK_DRIP_USD = 250; // optional single-stock drip, USD value at NAV
const COOLDOWN_MS = 6 * 60 * 60 * 1000;
const lastClaim = new Map<string, number>(); // per server instance; fine for a testnet faucet

/**
 * POST /api/stocks/faucet { address, stock?: "TSLAc" }
 * Mints 1,000 tUSDC (and optionally ~$250 of any of the 415 test stocks) on Base Sepolia.
 * The server key needs MINT_ROLE on the test tokens (the deployer has it). Testnet only: on mainnet the
 * route does not exist (404).
 */
export async function POST(req: NextRequest) {
  if (!IS_TESTNET) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (!CASH_TOKEN.address) return NextResponse.json({ error: 'tUSDC is not deployed yet' }, { status: 503 });
  const { address, stock } = (await req.json().catch(() => ({}))) as { address?: string; stock?: string };
  if (!address || !ethers.isAddress(address)) return NextResponse.json({ error: 'valid address required' }, { status: 400 });

  const key = address.toLowerCase();
  const last = lastClaim.get(key) ?? 0;
  if (Date.now() - last < COOLDOWN_MS) {
    return NextResponse.json({ error: 'Faucet cooldown, try again later', retryAt: new Date(last + COOLDOWN_MS).toISOString() }, { status: 429 });
  }
  const target = stock ? findStock(stock) : undefined;
  if (stock && !target?.address) return NextResponse.json({ error: `unknown stock ${stock}` }, { status: 400 });
  lastClaim.set(key, Date.now());

  try {
    const signer = getStockAgentSigner();
    const nonce = await signer.getNonce('pending');
    const txs = [
      await getB20(CASH_TOKEN.address, signer).mint(address, ethers.parseUnits(String(CASH_DRIP), CASH_TOKEN.decimals), { nonce }),
    ];
    const unitPrice = target ? (await fetchAllStockPrices().then((r) => r.prices[target.symbol]?.price).catch(() => null)) ?? target.priceUsd ?? target.navPrice : null;
    if (target && unitPrice) {
      const units = (STOCK_DRIP_USD / unitPrice).toFixed(target.decimals);
      txs.push(await getB20(target.address, signer).mint(address, ethers.parseUnits(units, target.decimals), { nonce: nonce + 1 }));
    }
    await Promise.all(txs.map((t) => t.wait()));
    return NextResponse.json({ ok: true, cash: CASH_DRIP, stock: target?.symbol ?? null, txHashes: txs.map((t) => t.hash) });
  } catch (e) {
    lastClaim.delete(key);
    console.error('faucet failed', e);
    return NextResponse.json({ error: 'faucet failed' }, { status: 500 });
  }
}

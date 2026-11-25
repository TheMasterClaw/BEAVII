'use client';

import {
  CASH_TOKEN,
  DEPLOYMENT,
  FACTORY_ADDRESS,
  IS_DEPLOYED,
  IS_TESTNET,
  NETWORK,
  ORACLE_ADDRESS,
  STOCKS,
  STOCK_VAULT,
  VENUE_ADDRESS,
  explorerUrl,
} from '@/config/network';

function AddressRow({ label, address }: { label: string; address?: string }) {
  if (!address) return null;
  return (
    <li>
      {label}:{' '}
      <a className="font-mono text-xs hover:underline" href={explorerUrl(address)} target="_blank" rel="noopener noreferrer">
        {address}
      </a>
    </li>
  );
}

export default function SettingsPage() {
  const venueLabel = DEPLOYMENT.venue?.kind === 'uniswap-v3' ? 'Trading venue (Uniswap V3)' : 'Trading venue (testnet exchange)';
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Network and contract information for this deployment.</p>
      </div>

      <div className="space-y-6">
        <div className="border-b pb-4">
          <h2 className="text-2xl font-bold tracking-tight">Tokenized Stock ETFs</h2>
          <p className="text-muted-foreground">
            Running on {NETWORK.name} (Chain ID: {NETWORK.chainId})
          </p>
        </div>

        <div className="rounded-lg bg-muted/30 p-4 text-sm">
          <h3 className="mb-2 font-medium">How it works</h3>
          <p className="mb-3">
            Each ETF holds a weighted basket of {IS_TESTNET ? 'B-20 test tokens that mirror ' : ''}Coinbase tokenized stocks,
            priced by the shared price oracle. Deposits are swapped into the basket through the trading venue, and every
            trade must fill within the protocol&apos;s slippage cap of the oracle price. Deposit and redeem on the{' '}
            <a href="/dashboard/stocks" className="text-primary hover:underline">Tokenized Stocks</a> page.
          </p>

          <h4 className="mb-1 font-medium">Deployed contracts</h4>
          {IS_DEPLOYED ? (
            <ul className="mb-3 list-inside list-disc space-y-1">
              <AddressRow label="ETF factory" address={FACTORY_ADDRESS} />
              <AddressRow label="Price oracle" address={ORACLE_ADDRESS} />
              <AddressRow label={venueLabel} address={VENUE_ADDRESS} />
              <AddressRow label="Flagship ETF" address={STOCK_VAULT.address} />
              <AddressRow label={CASH_TOKEN.symbol} address={CASH_TOKEN.address} />
              <li>{STOCKS.length} listed stocks (see the Tokenized Stocks page)</li>
            </ul>
          ) : (
            <p className="mb-3">
              Not deployed yet. Run <code>node scripts/deploy.mjs --network {NETWORK.key}</code>.
            </p>
          )}

          <h4 className="mb-1 font-medium">Network</h4>
          <ul className="list-inside list-disc space-y-1">
            <li>Network name: {NETWORK.name}</li>
            <li>Chain ID: {NETWORK.chainId}</li>
            <li>Gas token: ETH</li>
            <li>
              Block explorer:{' '}
              <a href={NETWORK.blockExplorer} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                {NETWORK.blockExplorer}
              </a>
            </li>
            {NETWORK.faucetUrl && (
              <li>
                Gas faucet:{' '}
                <a href={NETWORK.faucetUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  Coinbase Developer Platform
                </a>
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

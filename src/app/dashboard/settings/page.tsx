'use client';

import { BaseETFClient } from "@/components/etf/base-etf-client";
import { BASE_SEPOLIA, CASH_TOKEN, IS_DEPLOYED, STOCKS, STOCK_VAULT, explorerUrl } from "@/config/base-sepolia";

export default function SettingsPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your account settings and advanced ETF configurations.
        </p>
      </div>

      {/* Base Sepolia tokenized-stock ETF */}
      <div className="space-y-6">
        <div className="border-b pb-4">
          <h2 className="text-2xl font-bold tracking-tight">Tokenized Stock ETF</h2>
          <p className="text-muted-foreground">
            Running on {BASE_SEPOLIA.name} (Chain ID: {BASE_SEPOLIA.chainId})
          </p>
        </div>

        <BaseETFClient onSuccess={() => console.log('Operation completed successfully')} />

        <div className="p-4 bg-muted/30 rounded-lg text-sm">
          <h3 className="font-medium mb-2">About the stock vault</h3>
          <p className="mb-3">
            The vault holds a weighted basket of Base B-20 test tokens that mirror Coinbase tokenized stocks, priced at
            live NAV. Deposit and redeem on the <a href="/dashboard/stocks" className="text-primary hover:underline">Tokenized Stocks</a> page.
          </p>

          <h4 className="font-medium mb-1">Deployed Contracts</h4>
          {IS_DEPLOYED ? (
            <ul className="list-disc list-inside mb-3 space-y-1">
              <li>Stock vault: <a className="text-xs font-mono hover:underline" href={explorerUrl(STOCK_VAULT.address)} target="_blank" rel="noopener noreferrer">{STOCK_VAULT.address}</a></li>
              <li>{CASH_TOKEN.symbol}: <a className="text-xs font-mono hover:underline" href={explorerUrl(CASH_TOKEN.address)} target="_blank" rel="noopener noreferrer">{CASH_TOKEN.address}</a></li>
              <li>B-20 factory: <code className="text-xs">0xB20f000000000000000000000000000000000000</code></li>
              <li>{STOCKS.length} test stocks (see the Tokenized Stocks page)</li>
            </ul>
          ) : (
            <p className="mb-3">Not deployed yet. Run <code>node scripts/deploy-base-sepolia.mjs</code>.</p>
          )}

          <h4 className="font-medium mb-1">Network Information</h4>
          <ul className="list-disc list-inside space-y-1">
            <li>Network Name: {BASE_SEPOLIA.name}</li>
            <li>RPC URL: https://sepolia.base.org</li>
            <li>Chain ID: {BASE_SEPOLIA.chainId}</li>
            <li>Symbol: ETH</li>
            <li>Block Explorer: <a href={BASE_SEPOLIA.blockExplorer} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{BASE_SEPOLIA.blockExplorer}</a></li>
            <li>Gas faucet: <a href={BASE_SEPOLIA.faucetUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Coinbase Developer Platform</a></li>
          </ul>
        </div>
      </div>

      {/* Additional Settings Sections */}
      <div className="space-y-6">
        <div className="border-b pb-4">
          <h2 className="text-2xl font-bold tracking-tight">Account Preferences</h2>
          <p className="text-muted-foreground">
            Configure your account settings and preferences.
          </p>
        </div>
        
        <div className="grid gap-6 md:grid-cols-2">
          <div className="p-4 border rounded-lg">
            <h3 className="font-medium mb-2">Notifications</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Configure how you receive notifications about your ETF portfolio.
            </p>
            <div className="space-y-2">
              <label className="flex items-center space-x-2">
                <input type="checkbox" defaultChecked className="rounded border-gray-300" />
                <span className="text-sm">Email notifications</span>
              </label>
              <label className="flex items-center space-x-2">
                <input type="checkbox" defaultChecked className="rounded border-gray-300" />
                <span className="text-sm">Rebalancing alerts</span>
              </label>
              <label className="flex items-center space-x-2">
                <input type="checkbox" className="rounded border-gray-300" />
                <span className="text-sm">Performance reports</span>
              </label>
            </div>
          </div>

          <div className="p-4 border rounded-lg">
            <h3 className="font-medium mb-2">Security</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Manage your security settings and wallet connections.
            </p>
            <div className="space-y-2">
              <button className="text-sm text-primary hover:underline">
                Change password
              </button>
              <br />
              <button className="text-sm text-primary hover:underline">
                Manage connected wallets
              </button>
              <br />
              <button className="text-sm text-primary hover:underline">
                Two-factor authentication
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* API & Developer Settings */}
      <div className="space-y-6">
        <div className="border-b pb-4">
          <h2 className="text-2xl font-bold tracking-tight">Developer Settings</h2>
          <p className="text-muted-foreground">
            Advanced settings for developers and API access.
          </p>
        </div>
        
        <div className="p-4 border rounded-lg">
          <h3 className="font-medium mb-2">API Access</h3>
          <p className="text-sm text-muted-foreground mb-3">
            Manage your API keys and access tokens.
          </p>
          <div className="space-y-2">
            <div className="flex items-center justify-between p-2 bg-gray-50 rounded">
              <span className="text-sm font-mono">bae_1234567890abcdef</span>
              <button className="text-sm text-red-600 hover:underline">Revoke</button>
            </div>
            <button className="text-sm text-primary hover:underline">
              Generate new API key
            </button>
          </div>
        </div>
      </div>
    </div>
  );
} 
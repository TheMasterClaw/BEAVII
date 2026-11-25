import { ExternalLink } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BASE_SEPOLIA, CASH_TOKEN, DEPLOYMENT, EXCHANGE_ADDRESS, FACTORY_ADDRESS, STOCKS, STOCK_VAULT, explorerUrl } from '@/config/base-sepolia';

export default function NetworkPage() {
  const contracts = [
    ['ITF factory', FACTORY_ADDRESS, 'Launches new ITFs (EIP-1167 clones)'],
    ['Stock exchange', EXCHANGE_ADDRESS, 'Shared NAV price feed; issues and retires stock tokens'],
    [`Flagship ITF (${STOCK_VAULT.symbol || 'bMAG7'})`, STOCK_VAULT.address, STOCK_VAULT.name],
    [`Test cash (${CASH_TOKEN.symbol})`, CASH_TOKEN.address, 'What you buy and redeem ITFs with'],
    ['Protocol agent', DEPLOYMENT.agentWallet, 'Syncs prices and rebalances the flagship'],
    ['B-20 factory', DEPLOYMENT.b20Factory || '0xB20f000000000000000000000000000000000000', 'Base precompile that created the stock tokens'],
  ].filter(([, addr]) => addr);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Network &amp; Contracts</h1>
        <p className="mt-1 text-muted-foreground">Where BEAVII runs and the contracts behind it. Account settings live in your wallet&apos;s login menu.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contracts on {BASE_SEPOLIA.name}</CardTitle>
          <CardDescription>{STOCKS.length} test stock tokens, browsable on the Tokenized Stocks page.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {contracts.length ? (
            <table className="w-full text-sm">
              <tbody>
                {contracts.map(([label, addr, note]) => (
                  <tr key={label} className="border-b last:border-0">
                    <td className="py-2 pr-4 align-top">
                      <div className="font-medium">{label}</div>
                      <div className="text-xs text-muted-foreground">{note}</div>
                    </td>
                    <td className="py-2 text-right align-top">
                      <a className="inline-flex items-center gap-1 break-all font-mono text-xs underline" href={explorerUrl(addr)} target="_blank" rel="noreferrer">
                        {addr} <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">
              Not deployed yet. Run <code>node scripts/deploy-base-sepolia.mjs</code>.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Network</CardTitle>
          <CardDescription>Add it to a wallet manually if it doesn&apos;t switch automatically.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            {[
              ['Network name', BASE_SEPOLIA.name],
              ['Chain ID', String(BASE_SEPOLIA.chainId)],
              ['RPC URL', 'https://sepolia.base.org'],
              ['Currency', BASE_SEPOLIA.nativeCurrency.symbol],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-mono">{v}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Explorer</dt>
              <dd>
                <a className="underline" href={BASE_SEPOLIA.blockExplorer} target="_blank" rel="noreferrer">sepolia.basescan.org</a>
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Gas faucet</dt>
              <dd>
                <a className="underline" href={BASE_SEPOLIA.faucetUrl} target="_blank" rel="noreferrer">Coinbase Developer Platform</a>
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

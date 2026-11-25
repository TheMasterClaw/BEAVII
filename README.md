# ETF Manager Frontend

## Tokenized stocks on Base Sepolia

The app now runs on **Base Sepolia (chain 84532)** with a tokenized-stock ETF, built for Base's
[Stocks Maxxing Season](https://www.base.org/stocksmaxxing) (Programmable Stock Markets track).

- **Test stocks:** Base B-20 Asset tokens created through the B-20 factory precompile
  (`0xB20f000000000000000000000000000000000000`). Each one mirrors a Coinbase tokenized stock on Base mainnet
  (same name, decimals and ISIN). **All 415** Coinbase tokenized stocks are included, shown as `tAAPLc`, `tBRK.Bc`
  and so on. `scripts/create-stock-tokens.mjs` creates them with deterministic salts and grants the StockExchange
  MINT/BURN in the creation call. It's re-runnable and picks up new listings.
- **Prices** ([`src/lib/stock-prices-core.mjs`](src/lib/stock-prices-core.mjs)): the issuer's NAV from the
  [Coinbase Tokenized Stocks API](https://docs.base.org/sdks/tokenized-stocks/overview) where published (13 stocks).
  The other 402 use the underlying's market price (Yahoo Finance, keyless, batched) × the token multiplier.
  Company names were cross-checked for all 415. The agent pushes prices onto the StockExchange in batches of 100
  (`/api/stocks/agent`, plus a weekday Vercel cron and a "Sync NAV" button).
- **ETFs anyone can launch:** [`contracts/ETFFactory.sol`](contracts/ETFFactory.sol) clones
  [`contracts/StockBasketVault.sol`](contracts/StockBasketVault.sol) (EIP-1167, ~0.8M gas). The creator becomes the
  **manager**: they pick up to 20 stocks, set weights, rebalance, and earn the ETF's fees. Each ETF is an ERC-20 share
  token. Deposit tUSDC and the basket is bought at NAV. Redeem for tUSDC at NAV, or in kind.
- **Shared exchange:** [`contracts/StockExchange.sol`](contracts/StockExchange.sol) is the one NAV price feed and the only
  holder of MINT/BURN on the test tokens, so a new ETF needs no role grants. Issuance-style minting stands in for buying
  through a venue on testnet.
- **UI:** `/dashboard/create` (launch an ETF), `/dashboard/etfs` (browse, or see the ones you manage),
  `/dashboard/etfs/<address>` (invest, redeem, and the manager console), `/dashboard/stocks` (flagship + catalog).

### Manager fees

| Fee | Limit | How it is paid |
| --- | --- | --- |
| Management | 5% / year | Streamed: new shares are minted continuously, so the manager owns `rate × time` of AUM |
| Entry | 1% | Taken from the shares minted on each deposit |
| Exit | 1% | Taken from the shares redeemed |

Fees are paid in the ETF's own shares to the manager's `feeRecipient`, so earnings rise and fall with the fund. The
protocol keeps `protocolFeeBps` of every fee (factory setting, max 30%, default 20%) for its `treasury`. Holder
protections: fee **increases** wait 3 days (`setFees` queues them, `applyPendingFees` activates them), while decreases
apply at once. Pausing an ETF stops deposits and cash redemptions, but **in-kind redemption always works**. Rebalancing
trades at the exchange NAV, so it never changes the fund's value.

### Deploy

```bash
bun install
npm run contracts:compile        # only after editing contracts/*.sol
npm run deploy:base-sepolia      # 1st run generates DEPLOYER_PRIVATE_KEY in .env.local and prints its address
# fund that address at https://portal.cdp.coinbase.com/onchain-tools/faucet (0.02 Base Sepolia ETH is plenty)
node scripts/deploy-base-sepolia.mjs --core   # tUSDC, StockExchange, vault implementation, ETFFactory
node scripts/create-stock-tokens.mjs          # B-20 stock tokens (grants the exchange MINT/BURN)
npm run deploy:base-sepolia      # lists stocks, seeds prices, creates the flagship bMAG7 via the factory
bun run dev                      # open http://localhost:3000/dashboard/stocks
```

The deploy script can be re-run safely: tokens use deterministic salts (`getB20Address`), and finished steps are skipped.
See `.env.example` for `STOCK_AGENT_SECRET` / `CRON_SECRET`, which gate rebalancing and the cron.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/stocks?address=` | Catalog, live NAV, vault holdings, wallet balances |
| `POST /api/stocks/faucet` `{address, stock?}` | Mint 1,000 tUSDC (+ ~$250 of one stock); 6h cooldown |
| `POST /api/stocks/agent` `{action}` | `sync-prices` (open, rate-limited), `rebalance` and `set-weights` (Bearer secret) |
| `GET /api/flow/portfolio` | Vault portfolio in the legacy ITF shape |
| `GET /api/etfs?manager=` | Every user-created ETF (or one manager's): AUM, NAV, fees, manager earnings |
| `GET /api/etfs/:address?account=` | One ETF: holdings, target vs actual weights, pending fee changes, account position |

> Testnet only. Test tokens have no value. Mainnet Coinbase tokenized stocks are only available to eligible persons
> outside the US, and the program rules exclude products that enable trading for US users.


## Network: Base only

BAEVII is a **Base-only** app. There is no chain switcher, bridge or cross-chain swap.

- **Network:** Base Sepolia (chain ID `84532`, `0x14a34`)
- **RPC:** `https://sepolia.base.org` (override with `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL` / `BASE_SEPOLIA_RPC_URL`)
- **Explorer:** https://sepolia.basescan.org
- **Config:** [`src/config/base-sepolia.ts`](src/config/base-sepolia.ts), with addresses in
  [`src/config/deployments/base-sepolia.json`](src/config/deployments/base-sepolia.json)

When you connect, the wallet is asked to switch to Base Sepolia, and to add the network if it isn't there yet.

## Setup

```bash
bun install
cp .env.example .env.local   # fill in the values
bun run dev
```

## Testing

Run tests with:
```
bun test
```

## Building for Production

Build the application for production:
```
bun run build
```

Start the production server:
```
bun run start
```

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

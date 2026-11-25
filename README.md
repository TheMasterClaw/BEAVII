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
  (`/api/stocks/agent`, run by the weekday Vercel cron; syncing needs the agent secret).
- **ETFs anyone can launch:** [`contracts/ETFFactory.sol`](contracts/ETFFactory.sol) clones
  [`contracts/StockBasketVault.sol`](contracts/StockBasketVault.sol) (EIP-1167, ~0.8M gas). The creator becomes the
  **manager**: they pick up to 20 stocks, set weights, rebalance, and earn the ETF's fees. Each ETF is an ERC-20 share
  token. Deposit tUSDC and the basket is bought at NAV. Redeem for tUSDC at NAV, or in kind.
- **Shared exchange:** [`contracts/StockExchange.sol`](contracts/StockExchange.sol) is the one NAV price feed and the only
  holder of MINT/BURN on the test tokens, so a new ETF needs no role grants. Issuance-style minting stands in for buying
  through a venue on testnet.
- **UI:** `/dashboard` (portfolio: holdings, ITFs you manage, first-run steps), `/dashboard/etfs` (explore ITFs),
  `/dashboard/etfs/<address>` (buy, redeem, and the manager console), `/dashboard/create` (launch an ITF),
  `/dashboard/stocks` (catalog, live prices, test funds), `/dashboard/agents` (your AI agents),
  `/dashboard/agent` (protocol agent status) and `/dashboard/settings` (network and contracts).

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
npm run setup:agent              # 1st run generates STOCK_AGENT_PRIVATE_KEY; fund it, run again to grant its roles
bun run dev                      # open http://localhost:3000/dashboard/stocks
```

The deploy script can be re-run safely: tokens use deterministic salts (`getB20Address`), and finished steps are skipped.
See `.env.example` for `STOCK_AGENT_SECRET` / `CRON_SECRET`, which gate rebalancing and the cron.

**Keys:** the deployer owns the exchange and factory and admins every token, so it stays on your machine. The web
server signs with `STOCK_AGENT_PRIVATE_KEY` only (price sync, flagship rebalance, faucet mints). In production the
app refuses to start signing without it, or if it equals the deployer key. Do not set `DEPLOYER_PRIVATE_KEY` on Vercel.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/stocks?address=` | Catalog, live NAV, vault holdings, wallet balances |
| `POST /api/stocks/faucet` `{address, stock?}` | Mint 1,000 tUSDC (+ ~$250 of one stock); 6h cooldown per address and IP, hourly cap |
| `POST /api/stocks/agent` `{action}` | `sync-prices`, `rebalance`, `set-weights` (all need the Bearer secret) |
| `POST /api/flow/rebalance` | Legacy flagship rebalance (Bearer secret) |
| `GET /api/flow/portfolio` | Vault portfolio in the legacy ITF shape |
| `GET /api/etfs?manager=` | Every user-created ETF (or one manager's): AUM, NAV, fees, manager earnings |
| `GET /api/etfs/:address?account=` | One ETF: holdings, target vs actual weights, pending fee changes, account position |
| `GET /api/portfolio?account=` | An account's ITF positions, the ITFs it manages, and its tUSDC |
| `GET /api/flow/agent` | Protocol agent status: gas, authorizations, flagship price age (all onchain) |

> Testnet only. Test tokens have no value. Mainnet Coinbase tokenized stocks are only available to eligible persons
> outside the US, and the program rules exclude products that enable trading for US users.

**Legal notes.** The app shows a site-wide testnet notice and links to [`/terms`](src/app/terms/page.tsx) and
[`/privacy`](src/app/privacy/page.tsx). The UI says "ITF", not "ETF", because ETF is a regulated term. ISINs are
kept in the data but not shown or searchable in the UI. The non-Coinbase prices come from Yahoo Finance's unofficial
endpoint, whose terms forbid commercial use. That is fine for a demo, but switch to a licensed market-data provider
before running this as a product. A mainnet version (real assets, manager fees, a protocol treasury) would need
securities counsel, KYC/AML and geoblocking first.

### Verify with X

`/verify` links a wallet to an X account. The wallet signs a message (no gas), then the user signs in with X
(OAuth 2.0 + PKCE, read-only scopes). The server reads `GET /2/users/me` once, revokes the token, and stores only the
X id, handle and display name with the wallet. It uses the same database as agent accounts (Supabase:
`supabase/migrations/*_x_links.sql`). One X account maps to one wallet: a new link replaces the old one on both sides.

Setup: create an X developer app with OAuth 2.0 enabled, then set `X_CLIENT_ID`, `X_CLIENT_SECRET` and
`X_VERIFY_SECRET` (see `.env.example`). Register the callback URL `https://<your-domain>/api/verify-x/callback`.
Each verification makes one `users/me` call, so check your X API plan's limits.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/verify-x/start` `{address, issuedAt, signature}` | Checks the wallet signature and returns the X sign-in URL |
| `GET /api/verify-x/callback` | X redirects here; saves the link and returns to `/verify` |
| `GET /api/verify-x/status/:address` | Public: the X handle linked to a wallet |
| `POST /api/verify-x/unlink` `{address, issuedAt, signature}` | Deletes the wallet's link |

### Connect your own agent (Hermes, OpenClaw, Grok bots, ...)

Users connect their own AI agents at **`/dashboard/agents`**. Every agent gets **its own account**: a wallet owned by
the user who created it. An agent can only trade with:

1. **Funds in its own account.** The owner sends it tUSDC (and ETH for gas, or let the testnet sponsor cover it).
   What it buys stays in its account. The owner can withdraw everything back at any time.
2. **The owner's funds, up to what the owner allows on-chain:**

| Permission | Granted by the owner | What the agent can do |
| --- | --- | --- |
| Spend cash | `tUSDC.approve(agent, amount)` | Buy ETF shares with up to that much of the owner's tUSDC; the shares go to the owner |
| Sell shares | `etf.approve(agent, shares)` | Redeem up to that many of the owner's ETF shares; the tUSDC goes to the owner |
| Rebalance | `etf.setAgentAuthorization(agent, true)` (ETF managers) | Rebalance that ETF |

The dashboard has buttons for each of these and for revoking them. The only place an agent can send funds is its
owner's wallet. Owners can also set a maximum trade size, issue a new API key, or revoke the key; a revoked agent's
funds can still be withdrawn.

**Setup**

```bash
echo "AGENT_WALLET_SEED=$(openssl rand -hex 32)" >> .env.local   # derives every agent wallet; keep it secret and backed up
```

Agent wallets are derived from `AGENT_WALLET_SEED`, so no private key is stored. Losing the seed loses every
agent wallet, and leaking it exposes them all. The registry (owners, key hashes, limits) uses Supabase when `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are set (run [`supabase/migrations/20261125000000_agent_accounts.sql`](supabase/migrations/20261125000000_agent_accounts.sql)
once in the SQL editor), or Upstash Redis via `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`. One of the two is
required on Vercel; locally the registry falls back to `.data/agents.json`.
On testnet, `STOCK_AGENT_PRIVATE_KEY` tops up agent gas (0.001 ETH when below 0.0003); set `AGENT_GAS_SPONSOR=off`
to turn that off.

**Tools** (all act from the agent's own wallet)

| Tool | Does |
| --- | --- |
| `get_account` | The agent's balances, trade limit, and every permission the owner has granted. Agents should call it first |
| `list_etfs`, `get_etf`, `get_stock_market` | Market data |
| `buy_etf` `{etf, amountUsd, fundsFrom: agent\|owner}` | Buy shares at NAV |
| `sell_etf` `{etf, shares\|all, sharesOf: agent\|owner, minCashOut?}` | Redeem shares for tUSDC |
| `rebalance_etf` `{etf}` | Requires the ETF manager's authorization |
| `set_etf_weights` `{etf, weights}` | Only for ETFs whose ownership the agent's wallet holds |
| `withdraw_to_owner` `{asset: cash\|eth\|<etf>, amount\|"all"}` | Send funds back to the owner |
| `sync_prices` | Refresh on-chain prices (at most every 2 min) when a trade reports stale prices |

Reads are limited to 60/min per agent and writes to 10/min.

**Connecting.** The dashboard shows the API key once. Agents send it as `Authorization: Bearer <key>`.

| Endpoint | Use |
| --- | --- |
| `POST /api/agents/v1/mcp` | MCP server (Streamable HTTP, JSON responses) for Hermes, OpenClaw, Claude, Cursor |
| `GET /api/agents/v1` | Tools as OpenAI-style `functions` for Grok/xAI and other function-calling bots |
| `GET /api/agents/v1/openapi.json` | OpenAPI 3.1 for GPT Actions, LangChain and other OpenAPI clients |
| `POST /api/agents/v1/tools/{name}` | Call one tool; the JSON body is its arguments |
| `GET`/`POST /api/agents/v1/accounts[/:id]` | Owner management (create, rotate, revoke, limits, withdraw), authorized by a wallet signature |

```yaml
# MCP client config (the exact keys vary by client)
mcp_servers:
  beavii:
    url: https://<your-domain>/api/agents/v1/mcp
    headers: { Authorization: "Bearer bva_..." }
```

```bash
curl -X POST https://<your-domain>/api/agents/v1/tools/buy_etf -H "Authorization: Bearer bva_..." \
  -d '{"etf":"0x1f5D...","amountUsd":25,"fundsFrom":"owner"}'
```

Notes: Agent wallets are custodied by the server, so whoever runs it can move agent funds (but not owners' funds
beyond what they allowed). Rate limits and per-wallet transaction ordering live in memory per server instance, so
on Vercel they are approximate. Each tool call is logged as `[agent-gateway] <agent id> (<name>, owner …)`. The code is in
[`src/lib/external-agents.ts`](src/lib/external-agents.ts) and [`src/lib/agent-accounts/`](src/lib/agent-accounts/).

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

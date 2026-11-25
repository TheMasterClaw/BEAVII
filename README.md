# BEAVII: tokenized-stock ETFs on Base

Anyone (or, at launch, approved managers) can create an ETF: a basket of up to 20 Coinbase tokenized stocks with
target weights and fees. Holders buy in with USDC and redeem for USDC or for the stocks themselves. Every screen
shows live onchain data; nothing on the site is mocked.

One codebase serves two networks, chosen by `NEXT_PUBLIC_NETWORK`:

| | `base-sepolia` (testnet, default) | `base` (mainnet) |
| --- | --- | --- |
| Stocks | B-20 test mirrors of all 415 Coinbase tokenized stocks | The real Coinbase tokenized stocks you list |
| Cash | tUSDC (free from the faucet) | USDC |
| Prices | Pushed by the agent (Coinbase NAV, else market price), bounded per update | Chainlink-style feeds, with an L2 sequencer check |
| Venue | `StockExchange`: issues/retires test tokens at NAV | `UniswapV3Venue`: real swaps through Uniswap V3 |
| Launching ETFs | Open to anyone | Approved managers only, per-ETF size cap |

## Contracts ([`contracts/`](contracts))

- **[`PriceOracle`](contracts/PriceOracle.sol)**: the one price source and asset registry. Per token: a feed
  (checked against its heartbeat) or an agent-pushed price (checked against `maxPriceAge`, and each agent update may
  move a fresh price by at most `maxDeviationBps`). `checkedPrice` reverts on missing or stale prices and while the
  Base sequencer is down or just back up.
- **[`StockBasketVault`](contracts/StockBasketVault.sol)**: one ETF (an EIP-1167 clone and an ERC-20 share token).
  - Deposits swap USDC into the basket through the venue, and redemptions sell back. Every fill must be within the
    factory's slippage cap of the oracle price, and depositors pass `minShares` / `minAmountOut`.
  - Shares are minted for the NAV a deposit actually added, so the depositor (not the holders) pays execution cost.
  - NAV uses internally tracked balances, so tokens sent straight to the vault can't move the share price
    (`sweep` returns them).
  - Stale prices stop deposits, cash redemptions and rebalances. **In-kind redemption always works**, even while
    paused.
  - Manager limits: basket changes wait 24 h once the ETF has holders, and fee increases wait 3 days. Rebalances run
    at most every 12 h and skip trades under $1.
- **[`ETFFactory`](contracts/ETFFactory.sol)**: creates ETFs. Oracle, venue and cash token are immutable. The owner
  sets launch parameters within hard caps: protocol fee share (≤30%), slippage cap (≤3%), the per-ETF TVL cap, the
  sanctions list, and who may create ETFs. The owner is also the guardian that can pause any ETF.
- **[`StockExchange`](contracts/StockExchange.sol)** (testnet only) and **[`UniswapV3Venue`](contracts/UniswapV3Venue.sol)** (mainnet): implement `IVenue`.
- All admin contracts use two-step ownership (`Ownable2Step`). The deploy script hands them to a multisig.

### Fees

| Fee | Limit | How it is paid |
| --- | --- | --- |
| Management | 5% / year | Streamed: new shares are minted continuously, so the manager owns `rate × time` of AUM |
| Entry | 1% | Taken from the shares minted on each deposit |
| Exit | 1% | Taken from the shares redeemed |

Fees are paid in the ETF's own shares; the protocol keeps `protocolFeeBps` of every fee for its treasury.

### Tests

```bash
bun run contracts:test     # Foundry: unit, fuzz and invariant tests (installs forge-std on first run)
```

## Run the app

```bash
bun install
cp .env.example .env.local   # fill in the values
bun run dev                  # http://localhost:3000/dashboard
bun run build                # type errors and lint errors fail the build
```

Pages: `/dashboard` (protocol totals, your positions), `/dashboard/stocks` (flagship ETF + stock catalog),
`/dashboard/etfs` and `/dashboard/etfs/<address>` (invest, redeem, manager console), `/dashboard/create`,
`/dashboard/analytics` (AUM, combined exposure, fees), `/dashboard/transactions` (your ETF activity from event logs).

| Endpoint | Purpose |
| --- | --- |
| `GET /api/stocks?address=` | Catalog, live and onchain prices, flagship holdings, wallet balances |
| `GET /api/etfs?manager=` · `GET /api/etfs/:address?account=` | ETFs, holdings, fees, pending changes, a position |
| `GET /api/portfolio?account=` | An account's positions across every ETF |
| `GET /api/analytics` | AUM, fees and combined stock exposure across ETFs |
| `GET /api/activity?account=` | An account's buys, redemptions and launches (event logs) |
| `GET /api/health` | RPC, price freshness, agent balance. 503 on failure, for uptime monitors |
| `GET\|POST /api/stocks/agent` | Price sync / flagship rebalance / basket change. Bearer `STOCK_AGENT_SECRET` or `CRON_SECRET` |
| `POST /api/stocks/faucet` | Testnet only: 1,000 tUSDC (+ ~$250 of a stock) |

## Deploy: Base Sepolia

```bash
npm run contracts:compile                                 # only after editing contracts/*.sol
node scripts/deploy.mjs --network base-sepolia --core     # 1st run generates a testnet DEPLOYER_PRIVATE_KEY; fund it, re-run
node scripts/create-stock-tokens.mjs                      # B-20 test stocks (grants the exchange MINT/BURN)
node scripts/deploy.mjs --network base-sepolia            # list stocks, seed prices, create the flagship
```

Every step is skipped when already done. The 415 test stock tokens and tUSDC from the first version are reused; the
v1 contract addresses are kept under `legacy` in `src/config/deployments/base-sepolia.json`.

## Deploy: Base mainnet

1. Copy `scripts/mainnet-listings.example.json` to `scripts/mainnet-listings.json`. For each stock, add its USD price
   feed and heartbeat and the fee tier of a liquid USDC/stock Uniswap V3 pool.
2. Set the mainnet section of `.env.local`: `OWNER_ADDRESS` (a Safe), a separate `AGENT_WALLET_ADDRESS` /
   `STOCK_AGENT_PRIVATE_KEY`, `PROTOCOL_TREASURY_ADDRESS`, `SWAP_ROUTER_ADDRESS`, `SEQUENCER_UPTIME_FEED`,
   `SANCTIONS_LIST_ADDRESS`, `TVL_CAP_USD`.
3. `npm run deploy:base:dry-run`. It refuses unless every feed answers within 5% of Coinbase NAV, every pool has
   liquidity, and the owner, agent and treasury are separate from the deployer (the owner must be a contract).
4. `npm run deploy:base`, then have the Safe call `acceptOwnership()` on the oracle, venue and factory.
5. Approve managers with `factory.setManagerApproval(manager, true)` from the Safe.
6. Deploy the app with `NEXT_PUBLIC_NETWORK=base`, a paid `RPC_URL` / `NEXT_PUBLIC_RPC_URL`, and the agent key.
   Point an uptime monitor at `/api/health`.

### Still required before real money (not solvable in code)

- **External audit** of `contracts/`, and a fork test against live Base pools for every listed stock.
- **Price feeds and liquidity.** Confirm each listed stock has a dependable USD feed on Base and a Uniswap V3 pool
  deep enough for your TVL cap. Confirm the tokens allow vaults, the venue and the router to hold and transfer them.
- **Legal review.** Fee-charging managed baskets of securities may be regulated where you or your users are.
  Coinbase tokenized stocks are only for eligible non-US persons. The geo-block (`src/middleware.ts`) and sanctions
  list are controls, not a compliance program; you also need Terms of Service and risk disclosures.
- **Key custody.** Run the agent key from a KMS or managed wallet rather than an env var, and keep the deployer key
  off servers.

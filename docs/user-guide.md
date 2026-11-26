# BAEVII User Guide

BAEVII lets you buy a basket of tokenized stocks in one transaction, or launch your own basket and earn its fees.
These baskets are called **ITFs** (index token funds). Each ITF is a token: when you own its shares, you own a slice
of every stock it holds.

> **This is a testnet demo.** Everything runs on Base Sepolia, a test network. The tokens have no value. Test stocks
> are simulated copies, not real shares, and nothing here is an offer or investment advice.

## Contents

1. [Before you start](#before-you-start)
2. [Log in](#log-in)
3. [Get test funds](#get-test-funds)
4. [Buy an ITF](#buy-an-itf)
5. [Redeem your shares](#redeem-your-shares)
6. [Track your portfolio](#track-your-portfolio)
7. [Browse tokenized stocks](#browse-tokenized-stocks)
8. [Launch your own ITF](#launch-your-own-itf)
9. [Manage your ITF](#manage-your-itf)
10. [Link your X account](#link-your-x-account)
11. [Connect an AI agent](#connect-an-ai-agent)
12. [Troubleshooting](#troubleshooting)
13. [Glossary](#glossary)

## Before you start

You need:

- **A way to log in.** Any crypto wallet works, or you can sign in with email or a social account.
- **A little Base Sepolia ETH** to pay network (gas) fees. It's free from the
  [Coinbase Developer Platform faucet](https://portal.cdp.coinbase.com/onchain-tools/faucet). A small amount lasts a
  long time.

Everything else, including the test cash you buy with, is free inside the app.

## Log in

Click **Log in** on the home page or any dashboard page. You can pick a wallet, or sign in with email or a social
account. Once you're in, the button shows your shortened address. Click it to open your account menu.

When you log in, your wallet is asked to switch to Base Sepolia. If the network isn't in your wallet yet, it will
offer to add it. You can also add it by hand with the details on **Network & Contracts**.

You can browse ITFs without logging in. You only need to log in to buy, redeem, launch or manage.

## Get test funds

ITFs are bought with **tUSDC**, a test dollar. There are three places to get it:

- **Portfolio**: the **Get 1,000 tUSDC** button in the *Get started* box (or **Get tUSDC** above your holdings).
- **Any ITF page**: the **Get 1,000 tUSDC** button in the *Test funds* box.
- **Tokenized Stocks**: **Get 1,000 tUSDC**, or **+$250** next to any stock to get 1,000 tUSDC plus about $250 of
  that stock.

You can claim once every 6 hours. If you see *Faucet cooldown, try again later*, wait and try again.

Remember that tUSDC doesn't pay for gas. You still need Base Sepolia ETH from the faucet linked above.

## Buy an ITF

1. Open **Explore ITFs** and choose a basket. Each card shows its name, ticker and key numbers.
2. On the ITF's page, find **Buy \<ticker\>**.
3. Enter how much tUSDC to spend and click **Approve & buy**.
4. Confirm in your wallet. You may be asked to confirm twice: once to let the ITF use your tUSDC, and once to buy.

Your tUSDC buys every stock in the basket at its current price (**NAV**), split by the basket's weights. You receive
ITF shares in return. The ITF may charge an **entry fee** of up to 1%. The fees are shown at the top of the page.

When the transaction goes through, a green message appears with a **View transaction** link to the block explorer.

## Redeem your shares

On the ITF's page, find **Redeem**.

1. Enter the number of shares, or click **Max** to redeem all of them.
2. Choose how you want to be paid:
   - **For cash (default):** you get tUSDC at the current NAV.
   - **In kind:** tick **Redeem in kind (receive the stock tokens)** to get your share of each stock instead.
3. Click **Redeem** and confirm in your wallet.

The ITF may charge an **exit fee** of up to 1%.

**In-kind redemption always works.** If a manager pauses their ITF, buying and cash redemptions stop, but you can
still redeem in kind and take the stocks out. On a paused ITF the in-kind option is switched on for you.

## Track your portfolio

**Portfolio** (`/dashboard`) is your home page. It shows:

| Figure | Meaning |
| --- | --- |
| Invested in ITFs | What your ITF shares are worth at today's NAV |
| Cash | Your tUSDC balance |
| ITFs you manage | How many ITFs you've launched |
| Manager fees earned | Fees your ITFs have paid you, valued when they were paid |

Below that are **Your holdings** (each ITF you own, with a **Buy / redeem** link) and **ITFs you manage**.

New accounts see a three-step *Get started* box instead: get test funds, buy an ITF, or launch your own.

Use **Refresh** to reload the numbers and **Activity on Basescan** to see every transaction from your address.

## Browse tokenized stocks

**Tokenized Stocks** lists every Coinbase tokenized stock on Base (over 400) as a test token, such as `tAAPLc`.

- Search by ticker or company name, and page through with **Previous** / **Next**.
- **Live price** is the current price. Hover over it to see where it comes from: the issuer's NAV for some stocks,
  and the market price of the underlying share for the rest.
- **You hold** shows your balance of each stock token.

You can't buy single stocks directly. You buy them through an ITF. The page also shows the flagship ITF, **bMAG7**,
and links to **Explore all ITFs** and **Launch your own**.

## Launch your own ITF

Anyone can launch an ITF. Whoever launches it becomes its **manager**: they choose the stocks and weights,
rebalance the basket, and earn its fees.

Open **Launch ITF** and fill in three sections.

### 1. Name your ITF

- **Name**, for example *AI Infrastructure Leaders*.
- **Ticker**, for example *AINFRA*.
- **Strategy**: a short description that investors will see.

### 2. Pick stocks and weights

- Search by ticker or company and add up to **20 stocks**.
- Give each stock a weight. Weights must add up to exactly **100%**, and each one must be above 0.
- **Equal weight** splits 100% evenly across your picks.

### 3. Set your fees

| Fee | Maximum | When it's charged |
| --- | --- | --- |
| Management | 5% per year | Continuously, while the fund exists |
| Entry | 1% | On each purchase |
| Exit | 1% | On each redemption |

**Pay fees to** is optional. Leave it blank to receive fees in your own wallet, or enter another address.

The **What you earn** box estimates your first-year income for a fund size you choose. The protocol keeps a share of
every fee (shown in the box). You keep the rest.

When you're ready, click **Launch ITF** and confirm in your wallet. It takes one transaction. You're then taken to
your new ITF's page. Share that link so people can invest, and buy in yourself to seed the fund.

## Manage your ITF

When you open an ITF you manage, it carries a **You manage this** badge and a **Manager console** appears below the
holdings.

### Earnings

Fees are paid to you as new shares of the ITF, so your earnings rise and fall with the fund. To turn them into cash,
redeem them like any other holder.

- **Earned to date**: fees already paid to you.
- **Accruing now**: management fees built up but not yet paid. Click **Collect accrued fees** to receive them.
- **Run rate**: what you'd earn in a year at today's fund size, after the protocol's share.

### Weights and rebalancing

- Change any stock's **target weight**. Set a weight to 0% to drop that stock.
- Add a new stock by entering its ticker (for example `AMDc`) and clicking **Add**.
- Click **Rebalance** to trade the basket back to its target weights. The button shows the current **drift**: how
  far the basket is from its targets.

Rebalancing trades at NAV, so it doesn't change the fund's value. It needs prices less than 7 days old. Prices are
updated automatically on a weekday schedule.

### Changing fees

- **Lowering** a fee takes effect immediately (**Lower fees now**).
- **Raising** a fee is scheduled with 3 days' notice (**Schedule increase**), so holders who disagree have time to
  leave. After 3 days, click **Apply** to put it into effect.

### Pausing

**Pause deposits** stops new purchases, cash redemptions and rebalancing. Holders can still redeem in kind. Click
**Unpause ITF** to resume.

## Link your X account

Open `/verify` to prove that you control both your wallet and an X (Twitter) account.

1. Click **Connect wallet** if you aren't logged in.
2. Click **Verify with X**. Your wallet asks you to sign a message. This is free and is not a transaction.
3. Sign in to X and approve the request.

You're sent back to the page, which shows *Linked to @yourhandle*. BAEVII reads only your X id, handle and display
name, and doesn't keep access to your X account.

- Each X account can be linked to one wallet, and each wallet to one X account. Linking again replaces the old link.
- **Anyone can look up which X handle is linked to a wallet.**
- Click **Remove link** at any time to delete it.

## Connect an AI agent

**Your Agents** lets you give your own AI agent (a Claude, Hermes, OpenClaw or Grok bot, for example) its own
account. You stay in control of what it can do.

### Create an agent

1. Open **Your Agents** and log in.
2. Enter a **Name** and, if you like, a **Max per trade (USD)** limit.
3. Sign the message in your wallet (free, no gas).
4. **Copy the API key straight away. It is shown only once.** Anyone with the key can trade with this agent's account.

Paste the key into your agent's settings. The key panel shows the connection details for MCP clients (Claude, Cursor,
Hermes, OpenClaw), function-calling bots and OpenAPI tools.

### What an agent can trade with

An agent can trade with two kinds of funds.

**Its own account.** Under **Fund its own account**, send it tUSDC and, if needed, a little ETH for gas
(**Send 0.002 ETH gas**). Whatever it buys stays in its account.

**Your funds, only as far as you allow.** Each permission is a separate on-chain approval from your wallet:

| Permission | Where | What the agent can do |
| --- | --- | --- |
| Spend your cash | **Let it spend your cash** | Buy ITFs with up to that much of your tUSDC. The shares go to you |
| Sell your shares | **ITF permissions → Allow selling** | Redeem up to that many of your shares in one ITF. The cash goes to you |
| Rebalance | **ITF permissions → Allow rebalancing** | Rebalance an ITF you manage |

Each permission has a matching **Revoke** or **Stop rebalancing** button.

### Staying in control

- An agent can only ever send funds to **your** wallet.
- **Withdraw to your wallet** pulls its tUSDC, ETH or ITF shares back to you at any time.
- **Set max / trade** caps the size of any single trade. Leave it blank for no limit.
- **New key** replaces the API key. The old key stops working.
- **Revoke key** shuts the agent out at once. You can still withdraw its funds afterwards, and **Re-activate** it later.

Good to know: agent wallets are held by the BAEVII server. Whoever runs the server can move funds in an agent's own
account, but not your funds beyond the permissions you granted. Only send an agent what you're comfortable with.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| The page shows **Wrong network** | Click **Switch to Base Sepolia**, or add the network by hand from **Network & Contracts** |
| A transaction fails with an out-of-gas or insufficient-funds error | Get Base Sepolia ETH from the CDP faucet |
| *Faucet cooldown, try again later* | You can claim tUSDC once every 6 hours per address |
| Buying or rebalancing fails because prices are stale | Prices sync on a weekday schedule. Try again after the next sync |
| **Buy** is disabled or fails on an ITF marked **Paused** | The manager has paused deposits. You can still redeem in kind |
| Your balances look out of date | Click **Refresh** |
| You lost an agent's API key | Open the agent on **Your Agents** and click **New key**. The old one stops working |

To check any transaction, use the **View transaction** link in the status message, or open your address on
[Basescan](https://sepolia.basescan.org).

## Glossary

| Term | Meaning |
| --- | --- |
| **ITF** | A basket of tokenized stocks, held as an ERC-20 share token |
| **NAV** | Net asset value: what one share is worth, based on the current prices of the stocks inside |
| **AUM** | Assets under management: the total value of an ITF |
| **tUSDC** | Test dollars used to buy and redeem ITFs. No real value |
| **Manager** | The person who launched an ITF. They set its stocks, weights and fees, and earn its fees |
| **Rebalance** | Trading the basket back to its target weights |
| **Drift** | How far the basket has moved from its target weights |
| **In-kind redemption** | Redeeming shares for the stock tokens themselves instead of cash |
| **Gas** | The network fee for a transaction, paid in Base Sepolia ETH |

See also the [Terms](/terms) and [Privacy Notice](/privacy).

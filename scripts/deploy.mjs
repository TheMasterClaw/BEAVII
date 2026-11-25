// Deploys the ETF platform: PriceOracle, a trading venue, the StockBasketVault implementation and ETFFactory,
// then lists stocks, wires prices and (optionally) launches the flagship ETF.
//
//   node scripts/deploy.mjs --network base-sepolia [--core]
//   node scripts/deploy.mjs --network base --dry-run      # mainnet: every preflight check, no transactions
//   node scripts/deploy.mjs --network base                # mainnet: deploy
//
// base-sepolia (testnet)
//   venue = StockExchange (mints/burns test tokens at the oracle NAV), cash = tUSDC (B-20), prices pushed by the agent.
//   Fresh deploy: `--core` (tUSDC, oracle, exchange, factory), then scripts/create-stock-tokens.mjs, then run again
//   to grant the exchange its roles, list stocks, seed prices and create the flagship.
//
// base (mainnet)
//   venue = UniswapV3Venue, cash = USDC, stocks = the real Coinbase tokenized stocks, prices = Chainlink-style feeds.
//   Listings come from scripts/mainnet-listings.json (see mainnet-listings.example.json): for every symbol a price
//   feed + heartbeat and a Uniswap V3 pool fee tier. Preflight refuses to deploy unless every feed answers fresh, every
//   pool exists with liquidity, and the owner, agent and treasury are separate from the deployer.
//   Ownership of oracle, venue and factory is handed to OWNER_ADDRESS (a Safe) with Ownable2Step: the Safe must call
//   acceptOwnership() on each to finish.
//
// Every step is skipped when already done (state lives in src/config/deployments/<network>.json).
//
// Env (.env.local):
//   DEPLOYER_PRIVATE_KEY      testnet: generated on first run if missing. mainnet: required, hardware-backed key advised
//   RPC_URL                   (testnet falls back to BASE_SEPOLIA_RPC_URL, then the public RPC)
//   AGENT_WALLET_ADDRESS      price/rebalance bot (mainnet: required, must differ from deployer and owner)
//   PROTOCOL_TREASURY_ADDRESS fee treasury (mainnet: required)
//   OWNER_ADDRESS             final owner of oracle, venue and factory (mainnet: required, a multisig)
//   PROTOCOL_FEE_BPS          protocol share of ETF fees (default 2000 = 20%, max 3000)
//   MAX_SLIPPAGE_BPS          per-trade slippage cap vs the oracle (default 100 = 1%, max 300)
//   mainnet only:
//   SWAP_ROUTER_ADDRESS       Uniswap V3 SwapRouter02 on Base
//   SEQUENCER_UPTIME_FEED     Chainlink L2 sequencer uptime feed on Base
//   SANCTIONS_LIST_ADDRESS    Chainalysis-style sanctions oracle (optional, strongly advised)
//   TVL_CAP_USD               per-ETF size cap for the staged launch (default 100000, 0 = none)
//   CASH_TOKEN_ADDRESS        override USDC (default: Circle USDC on Base)
//   MAINNET_LISTINGS          path to the listings file (default scripts/mainnet-listings.json)
import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';

// ---------------------------------------------------------------- args + env
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const NETWORK = opt('--network');
if (NETWORK !== 'base' && NETWORK !== 'base-sepolia') {
  console.error('Usage: node scripts/deploy.mjs --network base|base-sepolia [--core] [--dry-run]');
  process.exit(1);
}
const MAINNET = NETWORK === 'base';
const CORE_ONLY = flag('--core');
const DRY_RUN = flag('--dry-run');

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const envPath = path.join(root, '.env.local');
const outPath = path.join(root, `src/config/deployments/${NETWORK}.json`);
for (const line of fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8').split('\n') : []) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

const NET = MAINNET
  ? { chainId: 8453n, explorer: 'https://basescan.org', rpc: process.env.RPC_URL || 'https://mainnet.base.org' }
  : { chainId: 84532n, explorer: 'https://sepolia.basescan.org', rpc: process.env.RPC_URL || process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org' };
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const B20_FACTORY = '0xB20f000000000000000000000000000000000000';
const SALT_PREFIX = process.env.B20_SALT_PREFIX || 'beavii-stocks-v1';
const MAX_SUPPLY_CAP = (1n << 128n) - 1n;
const ROLE = (n) => ethers.id(n);
const LIST_BATCH = 100;
const FLAGSHIP = { name: 'BEAVII Magnificent 7', symbol: 'bMAG7', symbols: ['AAPLc', 'MSFTc', 'NVDAc', 'GOOGLc', 'AMZNc', 'METAc', 'TSLAc'] };
const FLAGSHIP_FEES = { managementFeeBps: 50, entryFeeBps: 0, exitFeeBps: 0 }; // 0.50%/yr

const fail = (msg) => {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
};

if (!process.env.DEPLOYER_PRIVATE_KEY) {
  if (MAINNET) fail('DEPLOYER_PRIVATE_KEY is required on mainnet (this script never generates mainnet keys).');
  const w = ethers.Wallet.createRandom();
  fs.appendFileSync(envPath, `\n# Base Sepolia deployer (testnet only, generated by scripts/deploy.mjs)\nDEPLOYER_PRIVATE_KEY=${w.privateKey}\n`);
  console.log(`Generated a new testnet deployer key and saved it to .env.local\n\n  Deployer address: ${w.address}\n`);
  console.log('Fund it with Base Sepolia ETH (0.05 ETH is plenty), then run this script again:');
  console.log('  https://portal.cdp.coinbase.com/onchain-tools/faucet');
  process.exit(0);
}

const provider = new ethers.JsonRpcProvider(NET.rpc);
const wallet = new ethers.NonceManager(new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider));
const deployer = await wallet.getAddress();
const addr = (name, fallback) => {
  const v = process.env[name];
  if (!v) return fallback;
  if (!ethers.isAddress(v)) fail(`${name} is not an address: ${v}`);
  return ethers.getAddress(v);
};
const agentWallet = addr('AGENT_WALLET_ADDRESS', MAINNET ? undefined : deployer);
const treasury = addr('PROTOCOL_TREASURY_ADDRESS', MAINNET ? undefined : deployer);
const finalOwner = addr('OWNER_ADDRESS', undefined);
const protocolFeeBps = Number(process.env.PROTOCOL_FEE_BPS ?? 2000);
const maxSlippageBps = Number(process.env.MAX_SLIPPAGE_BPS ?? 100);

const net = await provider.getNetwork();
if (net.chainId !== NET.chainId) fail(`RPC is chain ${net.chainId}, expected ${NETWORK} (${NET.chainId})`);
const bal = await provider.getBalance(deployer);
console.log(`${NETWORK}${DRY_RUN ? ' (dry run)' : ''}  deployer ${deployer}  balance ${ethers.formatEther(bal)} ETH`);

// ---------------------------------------------------------------- state (merge-on-save)
const readState = () => (fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : {});
const mine = {};
let state = readState();
const save = (patch) => {
  Object.assign(mine, patch);
  if (DRY_RUN) return;
  state = { ...readState(), ...mine };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(state, null, 2) + '\n');
};

// ---------------------------------------------------------------- helpers
const artifact = (n) => JSON.parse(fs.readFileSync(path.join(root, `src/lib/abis/${n}.json`), 'utf8'));
const ART = Object.fromEntries(['PriceOracle', 'StockExchange', 'UniswapV3Venue', 'StockBasketVault', 'ETFFactory'].map((n) => [n, artifact(n)]));
const isLive = async (a) => Boolean(a) && (await provider.getCode(a)) !== '0x';
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const mc = new ethers.Contract(MULTICALL3, ['function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[])'], provider);
async function multicall(calls) {
  const out = [];
  for (let i = 0; i < calls.length; i += 300) {
    const chunk = calls.slice(i, i + 300);
    const res = await mc.aggregate3(chunk.map((c) => ({ target: c.target, allowFailure: true, callData: c.iface.encodeFunctionData(c.fn, c.args ?? []) })));
    res.forEach((r, j) => out.push(r.success && r.returnData !== '0x' ? chunk[j].iface.decodeFunctionResult(chunk[j].fn, r.returnData)[0] : null));
  }
  return out;
}

async function send(label, txPromiseFn) {
  if (DRY_RUN) return console.log(`  · would ${label}`);
  const tx = await txPromiseFn();
  const r = await tx.wait();
  console.log(`  ✓ ${label}  ${r.hash}`);
  return r;
}

async function deploy(label, name, ctorArgs) {
  if (DRY_RUN) {
    console.log(`  · would deploy ${label}`);
    return { address: ethers.ZeroAddress, deployBlock: 0 };
  }
  const c = await new ethers.ContractFactory(ART[name].abi, ART[name].bytecode, wallet).deploy(...ctorArgs);
  const receipt = await c.deploymentTransaction().wait();
  console.log(`  ✓ ${label} ${c.target}`);
  return { address: c.target, deployTx: receipt.hash, deployBlock: receipt.blockNumber };
}
const contract = (name, address) => new ethers.Contract(address, ART[name].abi, wallet);

// ---------------------------------------------------------------- mainnet preflight
let listings = [];
if (MAINNET) {
  console.log('\n[preflight] mainnet checks');
  const problems = [];
  if (!agentWallet) problems.push('AGENT_WALLET_ADDRESS is required');
  if (!treasury) problems.push('PROTOCOL_TREASURY_ADDRESS is required');
  if (!finalOwner) problems.push('OWNER_ADDRESS (a multisig) is required');
  for (const [k, v] of [['AGENT_WALLET_ADDRESS', agentWallet], ['OWNER_ADDRESS', finalOwner], ['PROTOCOL_TREASURY_ADDRESS', treasury]]) {
    if (v && v === deployer) problems.push(`${k} must not be the deployer`);
  }
  if (agentWallet && finalOwner && agentWallet === finalOwner) problems.push('AGENT_WALLET_ADDRESS must not be the owner');
  if (finalOwner && (await provider.getCode(finalOwner)) === '0x') problems.push('OWNER_ADDRESS has no code: use a multisig (e.g. a Safe), not an EOA');
  for (const k of ['SWAP_ROUTER_ADDRESS', 'SEQUENCER_UPTIME_FEED']) if (!process.env[k]) problems.push(`${k} is required`);
  if (!process.env.SANCTIONS_LIST_ADDRESS) console.warn('  ! SANCTIONS_LIST_ADDRESS not set: deposits will not be sanctions-screened onchain');
  if (protocolFeeBps > 3000) problems.push('PROTOCOL_FEE_BPS must be <= 3000');
  if (maxSlippageBps > 300) problems.push('MAX_SLIPPAGE_BPS must be <= 300');
  if (bal < ethers.parseEther('0.005')) problems.push('deployer needs at least 0.005 ETH for gas');

  const listingsPath = process.env.MAINNET_LISTINGS || path.join(root, 'scripts/mainnet-listings.json');
  if (!fs.existsSync(listingsPath)) problems.push(`listings file missing: ${path.relative(root, listingsPath)} (copy scripts/mainnet-listings.example.json)`);
  else listings = JSON.parse(fs.readFileSync(listingsPath, 'utf8')).listings ?? [];
  if (fs.existsSync(listingsPath) && !listings.length) problems.push('listings file has no entries');

  const cash = addr('CASH_TOKEN_ADDRESS', BASE_USDC);
  // Coinbase token records for every listed symbol
  const records = [];
  let pageToken;
  for (let i = 0; i < 10; i++) {
    const u = new URL('https://api.coinbase.com/v1/tokenized-stocks');
    u.searchParams.set('page_size', '500');
    if (pageToken) u.searchParams.set('page_token', pageToken);
    const body = await (await fetch(u)).json();
    records.push(...(body.tokens ?? []));
    if (!(pageToken = body.next_page_token)) break;
  }
  const aggIface = new ethers.Interface([
    'function decimals() view returns (uint8)',
    'function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)',
  ]);
  const router = process.env.SWAP_ROUTER_ADDRESS && new ethers.Contract(process.env.SWAP_ROUTER_ADDRESS, ['function factory() view returns (address)'], provider);
  const uniFactory = router ? await router.factory().catch(() => null) : null;
  if (router && !uniFactory) problems.push('SWAP_ROUTER_ADDRESS does not look like a Uniswap SwapRouter02 (no factory())');
  const poolIface = new ethers.Interface(['function getPool(address,address,uint24) view returns (address)']);
  const liqIface = new ethers.Interface(['function liquidity() view returns (uint128)']);
  const now = Math.floor(Date.now() / 1000);

  if (process.env.SEQUENCER_UPTIME_FEED) {
    const [, answer, startedAt] = await new ethers.Contract(process.env.SEQUENCER_UPTIME_FEED, aggIface, provider).latestRoundData().catch(() => []);
    if (answer === undefined) problems.push('SEQUENCER_UPTIME_FEED does not answer latestRoundData()');
    else if (answer !== 0n) problems.push('sequencer uptime feed reports the sequencer DOWN');
    else console.log(`  ✓ sequencer up since ${new Date(Number(startedAt) * 1000).toISOString()}`);
  }

  for (const l of listings) {
    const rec = records.find((r) => r.symbol === l.symbol);
    if (!rec) {
      problems.push(`${l.symbol}: not in the Coinbase Tokenized Stocks API`);
      continue;
    }
    l.record = rec;
    if (!ethers.isAddress(l.feed ?? '')) problems.push(`${l.symbol}: feed address missing`);
    else {
      const f = new ethers.Contract(l.feed, aggIface, provider);
      const [dec, round] = await Promise.all([f.decimals().catch(() => null), f.latestRoundData().catch(() => null)]);
      if (dec === null || !round) problems.push(`${l.symbol}: feed ${l.feed} does not answer`);
      else {
        const age = now - Number(round[3]);
        const px = Number(round[1]) / 10 ** Number(dec);
        if (round[1] <= 0n) problems.push(`${l.symbol}: feed answer is not positive`);
        if (!(l.heartbeat > 0)) problems.push(`${l.symbol}: heartbeat (seconds) missing`);
        else if (age > l.heartbeat) console.warn(`  ! ${l.symbol}: feed is ${age}s old, over its ${l.heartbeat}s heartbeat (expected off market hours)`);
        const nav = Number(rec.nav_price ?? 0);
        if (nav > 0 && Math.abs(px - nav) / nav > 0.05) problems.push(`${l.symbol}: feed price ${px} is >5% from Coinbase NAV ${nav}: wrong feed?`);
        console.log(`  ✓ ${l.symbol} feed $${px.toFixed(2)} (${age}s old)`);
      }
    }
    if (!(l.poolFee > 0)) problems.push(`${l.symbol}: poolFee missing`);
    else if (uniFactory) {
      const [pool] = await multicall([{ target: uniFactory, iface: poolIface, fn: 'getPool', args: [cash, rec.contract_address, l.poolFee] }]);
      if (!pool || pool === ethers.ZeroAddress) problems.push(`${l.symbol}: no Uniswap V3 pool for USDC at fee ${l.poolFee}`);
      else {
        const [liq] = await multicall([{ target: pool, iface: liqIface, fn: 'liquidity' }]);
        if (!liq || liq === 0n) problems.push(`${l.symbol}: pool ${pool} has no in-range liquidity`);
        else console.log(`  ✓ ${l.symbol} pool ${pool}`);
      }
    }
  }
  if (problems.length) fail(`Preflight failed:\n  - ${problems.join('\n  - ')}`);
  console.log('  ✓ preflight passed');
  save({
    network: 'base',
    chainId: 8453,
    explorer: NET.explorer,
    deployer,
    agentWallet,
    cashToken: { symbol: 'USDC', name: 'USD Coin', decimals: 6, address: cash },
    stocks: listings.map((l) => ({
      symbol: l.symbol,
      testSymbol: l.symbol,
      name: l.record.name,
      address: ethers.getAddress(l.record.contract_address),
      mainnetAddress: ethers.getAddress(l.record.contract_address),
      decimals: l.record.decimals,
      isin: l.record.isin,
      iconUrl: l.record.icon_url,
      multiplier: Number(l.record.multiplier) || 1,
      hasNav: Boolean(l.record.nav_price),
    })),
  });
} else {
  if (bal < ethers.parseEther('0.002')) fail('Balance too low. Fund it at https://portal.cdp.coinbase.com/onchain-tools/faucet and re-run.');
  save({ network: 'base-sepolia', chainId: 84532, explorer: NET.explorer, deployer, agentWallet, b20Factory: B20_FACTORY });
}

// ---------------------------------------------------------------- 1. cash token (testnet only)
let cash = state.cashToken ?? mine.cashToken;
if (!MAINNET) {
  console.log('\n[1/7] tUSDC (B-20 cash token)');
  cash = cash?.address ? cash : { symbol: 'tUSDC', name: 'Test USD Coin (Base Sepolia)', decimals: 6 };
  const b20Factory = new ethers.Contract(B20_FACTORY, [
    'function createB20(uint8 variant, bytes32 salt, bytes params, bytes[] initCalls) payable returns (address)',
    'function getB20Address(uint8 variant, address sender, bytes32 salt) view returns (address)',
    'function isB20Initialized(address token) view returns (bool)',
  ], wallet);
  const b20 = new ethers.Interface(['function grantRole(bytes32 role, address account)', 'function updateSupplyCap(uint256 newSupplyCap)']);
  const salt = ethers.id(`${SALT_PREFIX}:${cash.symbol}`);
  const predicted = await b20Factory.getB20Address(0, deployer, salt);
  if (!(await b20Factory.isB20Initialized(predicted).catch(() => false))) {
    const params = ethers.AbiCoder.defaultAbiCoder().encode(
      ['tuple(uint8 version,string name,string symbol,address initialAdmin,uint8 decimals)'],
      [[1, cash.name, cash.symbol, deployer, cash.decimals]],
    );
    const initCalls = [
      b20.encodeFunctionData('updateSupplyCap', [MAX_SUPPLY_CAP]),
      b20.encodeFunctionData('grantRole', [ROLE('MINT_ROLE'), deployer]),
      b20.encodeFunctionData('grantRole', [ROLE('BURN_ROLE'), deployer]),
    ];
    await send(`create ${cash.symbol} -> ${predicted}`, () => b20Factory.createB20(0, salt, params, initCalls));
  } else console.log(`  = ${cash.symbol} ${predicted}`);
  cash = { ...cash, address: predicted };
  save({ cashToken: cash });
}

// ---------------------------------------------------------------- 2. oracle
console.log('\n[2/7] PriceOracle');
let oracleState = state.oracle;
if (!(await isLive(oracleState?.address))) {
  // testnet: 3-day staleness for weekday cron pushes, 20% per-update bound. mainnet: feeds carry their own heartbeat;
  // pushed prices (if ever enabled) must be under an hour old and move at most 5% per update.
  const maxAge = MAINNET ? 3600 : 3 * 86400;
  const maxDev = MAINNET ? 500 : 2000;
  oracleState = await deploy('PriceOracle', 'PriceOracle', [cash.address, agentWallet, deployer, maxAge, maxDev]);
  save({ oracle: oracleState });
} else console.log(`  = PriceOracle ${oracleState.address}`);
const oracle = contract('PriceOracle', oracleState.address);

// ---------------------------------------------------------------- 3. venue
console.log(`\n[3/7] venue (${MAINNET ? 'UniswapV3Venue' : 'StockExchange, testnet'})`);
let venueState = state.venue;
if (!(await isLive(venueState?.address))) {
  venueState = MAINNET
    ? { ...(await deploy('UniswapV3Venue', 'UniswapV3Venue', [cash.address, process.env.SWAP_ROUTER_ADDRESS, deployer])), kind: 'uniswap-v3' }
    : { ...(await deploy('StockExchange (testnet venue)', 'StockExchange', [oracleState.address, deployer])), kind: 'testnet-exchange' };
  save({ venue: venueState });
} else console.log(`  = venue ${venueState.address}`);

// ---------------------------------------------------------------- 4. implementation + factory
console.log('\n[4/7] ETFFactory');
let factoryState = state.factory ?? {};
if (!(await isLive(factoryState.implementation))) {
  const impl = await deploy('StockBasketVault implementation', 'StockBasketVault', []);
  factoryState = { implementation: impl.address };
}
if (!(await isLive(factoryState.address))) {
  const f = await deploy('ETFFactory', 'ETFFactory', [factoryState.implementation, oracleState.address, venueState.address, treasury, protocolFeeBps, agentWallet, maxSlippageBps, deployer]);
  factoryState = { ...factoryState, ...f, treasury, protocolFeeBps };
} else console.log(`  = ETFFactory ${factoryState.address}`);
save({ factory: factoryState });
const factory = contract('ETFFactory', factoryState.address);

if (!DRY_RUN) {
  if (!MAINNET) {
    const exchange = contract('StockExchange', venueState.address);
    if ((await exchange.factory()) === ethers.ZeroAddress) await send('exchange.setFactory (one-time)', () => exchange.setFactory(factory.target));
    if (!(await factory.permissionless())) await send('factory.setPermissionless(true) (testnet: anyone can launch)', () => factory.setPermissionless(true));
  } else {
    const cap = ethers.parseEther(String(process.env.TVL_CAP_USD ?? 100000));
    if ((await factory.tvlCapUsd()) !== cap) await send(`factory.setTvlCapUsd(${ethers.formatEther(cap)})`, () => factory.setTvlCapUsd(cap));
    const sl = process.env.SANCTIONS_LIST_ADDRESS;
    if (sl && (await factory.sanctionsList()).toLowerCase() !== sl.toLowerCase()) await send('factory.setSanctionsList', () => factory.setSanctionsList(sl));
    const seq = process.env.SEQUENCER_UPTIME_FEED;
    if ((await oracle.sequencerUptimeFeed()).toLowerCase() !== seq.toLowerCase()) await send('oracle.setSequencerUptimeFeed', () => oracle.setSequencerUptimeFeed(seq));
  }
}

// ---------------------------------------------------------------- 5. stocks: roles (testnet) / pools (mainnet)
const stocks = mine.stocks ?? readState().stocks ?? [];
if (!MAINNET) {
  console.log('\n[5/7] grant the testnet exchange MINT/BURN');
  const roleIface = new ethers.Interface(['function hasRole(bytes32 role, address account) view returns (bool)', 'function grantRole(bytes32 role, address account)']);
  const tokens = [cash, ...(CORE_ONLY ? [] : stocks)];
  const has = await multicall(tokens.flatMap((t) => ['MINT_ROLE', 'BURN_ROLE'].map((r) => ({ target: t.address, iface: roleIface, fn: 'hasRole', args: [ROLE(r), venueState.address] }))));
  let missing = 0;
  for (let i = 0; i < tokens.length; i++) {
    for (const [k, r] of ['MINT_ROLE', 'BURN_ROLE'].entries()) {
      if (has[i * 2 + k]) continue;
      missing++;
      await send(`${tokens[i].testSymbol || tokens[i].symbol} ${r}`, () => new ethers.Contract(tokens[i].address, roleIface, wallet).grantRole(ROLE(r), venueState.address));
    }
  }
  if (!missing) console.log(`  = all ${tokens.length} tokens already grant the exchange`);
  if (CORE_ONLY) {
    console.log(`\nCore deployed. Oracle ${oracleState.address}  Exchange ${venueState.address}  Factory ${factoryState.address}`);
    console.log('Next: node scripts/create-stock-tokens.mjs, then re-run this script without --core.');
    process.exit(0);
  }
  if (!stocks.length) fail('No stocks in the deployment file yet. Run scripts/create-stock-tokens.mjs, then re-run this script.');
} else {
  console.log('\n[5/7] venue pool fees');
  const venue = contract('UniswapV3Venue', venueState.address);
  for (const l of listings) {
    const token = ethers.getAddress(l.record.contract_address);
    if (!DRY_RUN && Number(await venue.poolFee(token)) === l.poolFee) continue;
    await send(`venue.setPoolFee ${l.symbol} ${l.poolFee}`, () => venue.setPoolFee(token, l.poolFee));
  }
}

// ---------------------------------------------------------------- 6. list + prices
console.log(`\n[6/7] list ${stocks.length} stocks on the oracle`);
const listedNow = DRY_RUN ? stocks.map(() => false) : await multicall(stocks.map((s) => ({ target: oracleState.address, iface: oracle.interface, fn: 'isListed', args: [s.address] })));
const unlisted = stocks.filter((_, i) => !listedNow[i]).map((s) => s.address);
for (let i = 0; i < unlisted.length; i += LIST_BATCH) {
  const batch = unlisted.slice(i, i + LIST_BATCH);
  await send(`setListed ${i + 1}-${i + batch.length}`, () => oracle.setListed(batch, true));
}
if (MAINNET) {
  for (const l of listings) {
    const token = ethers.getAddress(l.record.contract_address);
    if (!DRY_RUN) {
      const f = await oracle.feeds(token);
      if (f.aggregator.toLowerCase() === l.feed.toLowerCase() && Number(f.heartbeat) === l.heartbeat) continue;
    }
    await send(`oracle.setFeed ${l.symbol}`, () => oracle.setFeed(token, l.feed, l.heartbeat));
  }
} else {
  const toPrice8 = (n) => ethers.parseUnits(Number(n).toFixed(8), 8);
  const priced = stocks.filter((s) => Number(s.priceUsd ?? s.navPrice) > 0);
  const onchain = await multicall(priced.map((s) => ({ target: oracleState.address, iface: oracle.interface, fn: 'price', args: [s.address] })));
  const seed = priced.filter((_, i) => !onchain[i]);
  for (let i = 0; i < seed.length; i += LIST_BATCH) {
    const batch = seed.slice(i, i + LIST_BATCH);
    await send(`seed prices ${i + 1}-${i + batch.length}`, () => oracle.setPrices(batch.map((s) => s.address), batch.map((s) => toPrice8(s.priceUsd ?? s.navPrice))));
  }
}

// ---------------------------------------------------------------- 7. flagship ETF
console.log(`\n[7/7] flagship ETF ${FLAGSHIP.symbol}`);
const basket = FLAGSHIP.symbols.map((sym) => stocks.find((s) => s.symbol === sym)).filter(Boolean);
if (await isLive(state.vault?.address)) console.log(`  = ${FLAGSHIP.symbol} ${state.vault.address}`);
else if (basket.length !== FLAGSHIP.symbols.length) {
  console.log(`  - skipped: listings cover ${basket.length}/${FLAGSHIP.symbols.length} flagship stocks (${FLAGSHIP.symbols.join(', ')})`);
} else {
  const base = Math.floor(10_000 / basket.length);
  const weights = basket.map((_, i) => (i === 0 ? 10_000 - base * (basket.length - 1) : base));
  const params = {
    name: FLAGSHIP.name,
    symbol: FLAGSHIP.symbol,
    description: 'Equal-weight basket of the seven largest US tech stocks.',
    feeRecipient: treasury,
    tokens: basket.map((s) => s.address),
    weights,
    fees: FLAGSHIP_FEES,
  };
  // The flagship is managed by the final owner (multisig) on mainnet, the deployer on testnet
  const manager = MAINNET ? finalOwner : deployer;
  const r = await send('createETFFor', () => factory.createETFFor(params, manager));
  if (r) {
    const ev = r.logs.map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === 'ETFCreated');
    save({
      vault: { address: ev.args.vault, name: FLAGSHIP.name, symbol: FLAGSHIP.symbol, deployTx: r.hash },
      basket: basket.map((s, i) => ({ symbol: s.symbol, address: s.address, weight: weights[i] })),
    });
  }
}

// ---------------------------------------------------------------- ownership handoff
if (finalOwner && !DRY_RUN) {
  console.log(`\n[ownership] hand oracle, venue and factory to ${finalOwner}`);
  for (const [name, a] of [['PriceOracle', oracleState.address], [MAINNET ? 'UniswapV3Venue' : 'StockExchange', venueState.address], ['ETFFactory', factoryState.address]]) {
    const c = contract(name, a);
    const [owner, pending] = await Promise.all([c.owner(), c.pendingOwner()]);
    if (owner.toLowerCase() === finalOwner.toLowerCase()) console.log(`  = ${name} owned by ${finalOwner}`);
    else if (pending.toLowerCase() === finalOwner.toLowerCase()) console.log(`  … ${name}: waiting for ${finalOwner} to acceptOwnership()`);
    else await send(`${name}.transferOwnership(${finalOwner})`, () => c.transferOwnership(finalOwner));
  }
  console.log('  The owner must call acceptOwnership() on each contract to complete the handoff (Ownable2Step).');
} else if (MAINNET && DRY_RUN) {
  console.log(`\n[ownership] would hand oracle, venue and factory to ${finalOwner} (Ownable2Step; the Safe then accepts)`);
}

save({ deployedAt: new Date().toISOString() });
console.log(`\n${DRY_RUN ? 'Dry run complete, nothing was sent.' : `Done. Wrote ${path.relative(root, outPath)}`}`);
if (!DRY_RUN) {
  console.log(`Oracle:   ${NET.explorer}/address/${oracleState.address}`);
  console.log(`Venue:    ${NET.explorer}/address/${venueState.address}`);
  console.log(`Factory:  ${NET.explorer}/address/${factoryState.address}`);
  if (readState().vault) console.log(`Flagship: ${NET.explorer}/address/${readState().vault.address}`);
}

// Creates a Base Sepolia B-20 test mirror of EVERY Coinbase tokenized stock on Base (415 at the time of writing).
// Each token copies the real one's name, decimals and ISIN, with symbol prefixed "t" (TSLAc -> tTSLAc).
//
// Roles granted at creation (via factory initCalls, so no extra txs):
//   - deployer: MINT_ROLE + BURN_ROLE (testnet faucet)
//   - StockExchange (deployment.exchange.address): MINT_ROLE + BURN_ROLE (issues/retires stock for every ETF)
//
// Re-runnable: token addresses are deterministic (getB20Address(variant, deployer, salt)), existing tokens are
// skipped, and missing exchange roles on existing tokens are granted. Only `stocks[]` in the deployment JSON is
// written; the file is re-read before each save so keys written by scripts/deploy-base-sepolia.mjs are preserved.
//
// Usage: node scripts/create-stock-tokens.mjs [--no-exchange] [--limit N]
import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';
import { fetchAllStockPrices } from '../src/lib/stock-prices-core.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outPath = path.join(root, 'src/config/deployments/base-sepolia.json');
const args = process.argv.slice(2);
const NO_EXCHANGE = args.includes('--no-exchange');
const LIMIT = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
const CHAIN_ID = 84532n;
const B20_FACTORY = '0xB20f000000000000000000000000000000000000';
const SALT_PREFIX = process.env.B20_SALT_PREFIX || 'beavii-stocks-v1';
const MAX_SUPPLY_CAP = (1n << 128n) - 1n;
const CHUNK = 25; // txs in flight at once
const MINT_ROLE = ethers.id('MINT_ROLE');
const BURN_ROLE = ethers.id('BURN_ROLE');

for (const line of fs.existsSync(path.join(root, '.env.local')) ? fs.readFileSync(path.join(root, '.env.local'), 'utf8').split('\n') : []) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
if (!process.env.DEPLOYER_PRIVATE_KEY) throw new Error('DEPLOYER_PRIVATE_KEY missing (run scripts/deploy-base-sepolia.mjs once to generate it)');

const readState = () => (fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : {});
const exchange = readState().exchange?.address;
if (!exchange && !NO_EXCHANGE) {
  console.error('deployment.exchange.address is not set yet. Deploy the StockExchange first (scripts/deploy-base-sepolia.mjs),');
  console.error('or pass --no-exchange to create tokens now and grant exchange roles later.');
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org', undefined, { batchMaxCount: 20 });
const signer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
const wallet = new ethers.NonceManager(signer);
const deployer = signer.address;
if ((await provider.getNetwork()).chainId !== CHAIN_ID) throw new Error('RPC is not Base Sepolia');
console.log(`Deployer ${deployer}  ${ethers.formatEther(await provider.getBalance(deployer))} ETH  exchange ${exchange ?? '(none)'}`);

const factory = new ethers.Contract(
  B20_FACTORY,
  [
    'function createB20(uint8 variant, bytes32 salt, bytes params, bytes[] initCalls) payable returns (address)',
    'function getB20Address(uint8 variant, address sender, bytes32 salt) view returns (address)',
    'function isB20Initialized(address token) view returns (bool)',
  ],
  wallet,
);
const b20 = new ethers.Interface([
  'function grantRole(bytes32 role, address account)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function updateSupplyCap(uint256 newSupplyCap)',
]);

// ---------------------------------------------------------------- catalog + prices
const { records, prices } = await fetchAllStockPrices();
const catalog = records.slice(0, LIMIT);
console.log(`Coinbase catalog: ${records.length} stocks, ${Object.keys(prices).length} priced`);

function entryFor(r, address) {
  const p = prices[r.symbol];
  return {
    symbol: r.symbol,
    testSymbol: `t${r.symbol}`,
    name: r.name,
    address,
    mainnetAddress: r.contract_address,
    decimals: r.decimals,
    isin: r.isin,
    iconUrl: r.icon_url,
    multiplier: Number(r.multiplier) || 1,
    hasNav: Boolean(r.nav_price),
    navPrice: r.nav_price ? Number(r.nav_price) : null,
    navPriceUpdatedAt: r.nav_price_updated_at ?? null,
    priceUsd: p?.price ?? null,
    priceSource: p?.source ?? null,
    priceUpdatedAt: p?.updatedAt ?? null,
  };
}

function save(entries) {
  const state = readState(); // merge: never clobber keys owned by deploy-base-sepolia.mjs
  const bySymbol = new Map((state.stocks ?? []).map((s) => [s.symbol, s]));
  for (const e of entries) bySymbol.set(e.symbol, { ...bySymbol.get(e.symbol), ...e });
  state.stocks = [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
  state.stocksSyncedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(state, null, 2) + '\n');
}

// ---------------------------------------------------------------- plan (Multicall3: public RPC allows ~25 req/s)
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const mc = new ethers.Contract(
  MULTICALL3,
  ['function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[])'],
  provider,
);
async function multicall(calls) {
  const out = [];
  for (let i = 0; i < calls.length; i += 200) {
    const chunk = calls.slice(i, i + 200);
    const res = await mc.aggregate3(chunk.map((c) => ({ target: c.target, allowFailure: true, callData: c.iface.encodeFunctionData(c.fn, c.args) })));
    res.forEach((r, j) => out.push(r.success ? chunk[j].iface.decodeFunctionResult(chunk[j].fn, r.returnData)[0] : null));
  }
  return out;
}
const salts = catalog.map((r) => ethers.id(`${SALT_PREFIX}:${r.symbol}`));
const addrs = await multicall(salts.map((salt) => ({ target: B20_FACTORY, iface: factory.interface, fn: 'getB20Address', args: [0, deployer, salt] })));
const inited = await multicall(addrs.map((a) => ({ target: B20_FACTORY, iface: factory.interface, fn: 'isB20Initialized', args: [a] })));
const roles = exchange
  ? await multicall(addrs.flatMap((a) => [MINT_ROLE, BURN_ROLE].map((role) => ({ target: a, iface: b20, fn: 'hasRole', args: [role, exchange] }))))
  : [];
const plan = catalog.map((r, i) => {
  const exists = Boolean(inited[i]);
  const missingRoles = exists && exchange ? [MINT_ROLE, BURN_ROLE].filter((_, k) => !roles[i * 2 + k]) : [];
  return { r, salt: salts[i], address: addrs[i], exists, missingRoles };
});
const toCreate = plan.filter((p) => !p.exists);
const toGrant = plan.flatMap((p) => p.missingRoles.map((role) => ({ ...p, role })));
console.log(`Existing ${plan.length - toCreate.length}, to create ${toCreate.length}, exchange grants needed ${toGrant.length}`);
save(plan.filter((p) => p.exists).map((p) => entryFor(p.r, p.address)));

// ---------------------------------------------------------------- send in chunks
const enc = ethers.AbiCoder.defaultAbiCoder();
function createTx(p) {
  const params = enc.encode(
    ['tuple(uint8 version,string name,string symbol,address initialAdmin,uint8 decimals)'],
    [[1, `${p.r.name} (Test)`, `t${p.r.symbol}`, deployer, p.r.decimals]],
  );
  const grantees = [deployer, ...(exchange ? [exchange] : [])];
  const initCalls = [
    b20.encodeFunctionData('updateSupplyCap', [MAX_SUPPLY_CAP]),
    ...grantees.flatMap((a) => [b20.encodeFunctionData('grantRole', [MINT_ROLE, a]), b20.encodeFunctionData('grantRole', [BURN_ROLE, a])]),
  ];
  return factory.createB20(0, p.salt, params, initCalls, { gasLimit: 600_000 });
}

async function runChunked(items, label, send, onDone) {
  let ok = 0;
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const sent = [];
    for (const it of chunk) {
      try {
        sent.push({ it, tx: await send(it) });
      } catch (e) {
        console.error(`  ✗ ${label} ${it.r.symbol}: ${e.shortMessage ?? e.message}`);
        wallet.reset(); // resync nonce after a failed send
      }
    }
    // wait for the last tx, then read the rest one at a time (stays under the RPC rate limit)
    if (sent.length) await sent[sent.length - 1].tx.wait().catch(() => {});
    const results = [];
    for (const { it, tx } of sent) {
      results.push(await tx.wait().then((rc) => ({ it, rc }), (e) => ({ it, e })));
    }
    const done = [];
    for (const { it, rc, e } of results) {
      if (rc?.status === 1) done.push(it);
      else console.error(`  ✗ ${label} ${it.r.symbol} reverted ${e?.shortMessage ?? rc?.hash ?? ''}`);
    }
    ok += done.length;
    onDone?.(done);
    console.log(`  ${label}: ${Math.min(i + CHUNK, items.length)}/${items.length} sent, ${ok} confirmed`);
  }
  return ok;
}

await runChunked(toCreate, 'create', createTx, (done) => save(done.map((p) => entryFor(p.r, p.address))));
if (toGrant.length) {
  await runChunked(toGrant, 'grant', (g) => new ethers.Contract(g.address, b20, wallet).grantRole(g.role, exchange, { gasLimit: 120_000 }));
}

const final = readState().stocks ?? [];
console.log(`\nDone: ${final.length} stock tokens in ${path.relative(root, outPath)}  (${ethers.formatEther(await provider.getBalance(deployer))} ETH left)`);

// Redeploys the StockBasketVault implementation + ETFFactory after a vault change, keeping the shared
// StockExchange (its listings, prices and token roles stay as they are).
//
//   node scripts/migrate-factory.mjs              deploy impl + factory, point the exchange at the new factory
//   node scripts/migrate-factory.mjs --flagship   also recreate the flagship ETF on the new factory
//
// Old vaults keep working: they stay registered on the exchange (isVault), so holders can still deposit/withdraw.
// The previous factory/vault are kept in the deployment file under `legacy` so the app can still read them.
// Signed by DEPLOYER_PRIVATE_KEY (exchange + factory owner). Run locally only.
import fs from 'node:fs';
import path from 'node:path';
import { ethers } from 'ethers';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const statePath = path.join(root, 'src/config/deployments/base-sepolia.json');
for (const line of fs.readFileSync(path.join(root, '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}
const FLAGSHIP_FEES = { managementFeeBps: 50, entryFeeBps: 0, exitFeeBps: 0 };

const provider = new ethers.JsonRpcProvider(process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org');
if ((await provider.getNetwork()).chainId !== 84532n) throw new Error('RPC is not Base Sepolia');
const wallet = new ethers.NonceManager(new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider));
const deployer = await wallet.getAddress();
const art = (n) => JSON.parse(fs.readFileSync(path.join(root, `src/lib/abis/${n}.json`), 'utf8'));
const readState = () => JSON.parse(fs.readFileSync(statePath, 'utf8'));
const patchState = (patch) => fs.writeFileSync(statePath, JSON.stringify({ ...readState(), ...patch }, null, 2) + '\n');

const state = readState();
const exchange = new ethers.Contract(state.exchange.address, art('StockExchange').abi, wallet);
const oldFactory = new ethers.Contract(state.factory.address, art('ETFFactory').abi, provider);
const agent = process.env.STOCK_AGENT_PRIVATE_KEY ? new ethers.Wallet(process.env.STOCK_AGENT_PRIVATE_KEY).address : await oldFactory.defaultAgent();

async function send(label, p) {
  const r = await (await p).wait();
  console.log(`  ✓ ${label}  ${r.hash}`);
  return r;
}

if (!process.argv.includes('--flagship-only')) {
  const treasury = await oldFactory.treasury();
  const protocolFeeBps = await oldFactory.protocolFeeBps();
  const vaultArt = art('StockBasketVault');
  const factoryArt = art('ETFFactory');
  const impl = await new ethers.ContractFactory(vaultArt.abi, vaultArt.bytecode, wallet).deploy();
  await impl.waitForDeployment();
  console.log(`  ✓ vault implementation ${impl.target}`);
  const factory = await new ethers.ContractFactory(factoryArt.abi, factoryArt.bytecode, wallet).deploy(
    impl.target, exchange.target, treasury, protocolFeeBps, agent, deployer,
  );
  await factory.waitForDeployment();
  console.log(`  ✓ ETFFactory ${factory.target}`);
  await send('exchange.setFactory', exchange.setFactory(factory.target));
  const legacy = readState().legacy ?? [];
  legacy.push({ factory: state.factory, vault: state.vault, replacedAt: new Date().toISOString() });
  patchState({
    factory: { implementation: impl.target, address: factory.target, deployTx: factory.deploymentTransaction().hash, treasury, protocolFeeBps: Number(protocolFeeBps) },
    legacy,
  });
}

if (process.argv.includes('--flagship') || process.argv.includes('--flagship-only')) {
  const s = readState();
  const factory = new ethers.Contract(s.factory.address, art('ETFFactory').abi, wallet);
  const params = {
    name: s.vault.name,
    symbol: s.vault.symbol,
    description: 'Equal-weight basket of the seven largest US tech stocks, as Base tokenized-stock mirrors.',
    feeRecipient: await factory.treasury(),
    tokens: s.basket.map((b) => b.address),
    weights: s.basket.map((b) => b.weight),
    fees: FLAGSHIP_FEES,
  };
  const r = await send('createETFFor flagship', factory.createETFFor(params, deployer));
  const ev = r.logs.map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === 'ETFCreated');
  patchState({ vault: { address: ev.args.vault, name: s.vault.name, symbol: s.vault.symbol, deployTx: r.hash } });
  console.log(`  flagship ${ev.args.vault}`);
}
console.log('Done.');

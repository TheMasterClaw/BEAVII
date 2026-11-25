// Compiles contracts/*.sol with solc-js and writes { abi, bytecode } to src/lib/abis/<Name>.json
// Usage: node scripts/compile-contracts.mjs [extraDir]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const solc = require('solc');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dirs = [path.join(root, 'contracts'), ...process.argv.slice(2).map((d) => path.resolve(d))];
const outDir = process.env.ABI_OUT_DIR || path.join(root, 'src/lib/abis');

const sources = {};
for (const dir of dirs) {
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sol'))) {
    sources[path.relative(root, path.join(dir, f))] = { content: fs.readFileSync(path.join(dir, f), 'utf8') };
  }
}

function findImports(p) {
  for (const base of [path.join(root, 'node_modules'), root]) {
    const full = path.join(base, p);
    if (fs.existsSync(full)) return { contents: fs.readFileSync(full, 'utf8') };
  }
  return { error: `not found: ${p}` };
}

const input = {
  language: 'Solidity',
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    evmVersion: 'cancun',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
};
const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
const errors = (out.errors || []).filter((e) => e.severity === 'error');
for (const e of out.errors || []) console[e.severity === 'error' ? 'error' : 'warn'](e.formattedMessage);
if (errors.length) process.exit(1);

fs.mkdirSync(outDir, { recursive: true });
for (const [file, contracts] of Object.entries(out.contracts)) {
  if (!file.startsWith('contracts/') && !process.env.ABI_OUT_DIR) continue;
  for (const [name, c] of Object.entries(contracts)) {
    if (!c.evm.bytecode.object) continue; // interfaces
    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify({ contractName: name, abi: c.abi, bytecode: '0x' + c.evm.bytecode.object }, null, 2));
    console.log(`compiled ${name} -> ${path.relative(root, outDir)}/${name}.json`);
  }
}

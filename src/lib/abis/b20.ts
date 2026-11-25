/** Human-readable B-20 test token ABI (ERC-20 + mint/roles). Shared by ethers (server) and viem (client). */
export const B20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function mint(address to, uint256 amount)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function multiplier() view returns (uint256)',
] as const;

import { ethers } from 'ethers';

/** Default tolerance on top of fees for price moves between quote and execution (1%). */
export const DEFAULT_TOLERANCE_BPS = 100;

/**
 * Minimum acceptable output for a vault deposit or cash redemption: the expected amount at the live NAV,
 * less the vault fee that applies, less a tolerance for price moves and execution. Returned in raw units.
 * The vault separately caps every trade at the protocol slippage limit of the oracle price.
 */
export function minOutWithTolerance(expected: number, decimals: number, feeBps = 0, toleranceBps = DEFAULT_TOLERANCE_BPS): bigint {
  if (!Number.isFinite(expected) || expected <= 0) return BigInt(0);
  const factor = Math.max(0, 1 - (feeBps + toleranceBps) / 10_000);
  return ethers.parseUnits((expected * factor).toFixed(decimals), decimals);
}

/** Server-only: verify that a request was signed by the owner's wallet (EOA or ERC-1271 smart account). */
import { createHash } from 'node:crypto';
import { ethers } from 'ethers';
import { getBaseSepoliaProvider } from '@/lib/stock-vault';
import { agentStore } from './store';
import { ownerMessage, type OwnerAction } from './owner-message';

const MAX_AGE_MS = 10 * 60 * 1000;
const ERC1271 = new ethers.Interface(['function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)']);

export class OwnerAuthError extends Error {}

export async function verifyOwner(p: {
  action: OwnerAction;
  owner: string;
  agent: string;
  details?: Record<string, unknown>;
  issuedAt: string;
  signature: string;
}) {
  if (!ethers.isAddress(p.owner)) throw new OwnerAuthError('owner must be a 0x address');
  if (typeof p.signature !== 'string' || !p.signature.startsWith('0x')) throw new OwnerAuthError('signature required');
  const issued = Date.parse(p.issuedAt);
  if (!Number.isFinite(issued) || Date.now() - issued > MAX_AGE_MS || issued - Date.now() > 60_000) {
    throw new OwnerAuthError('signature expired, sign again');
  }
  const message = ownerMessage(p);
  if (!(await signedBy(p.owner, message, p.signature))) throw new OwnerAuthError('signature does not match owner');
  // Each signed request works once.
  const id = createHash('sha256').update(p.signature.toLowerCase()).digest('hex');
  if (!(await agentStore().claimOnce(`sig:${id}`, Math.ceil(MAX_AGE_MS / 1000) + 120))) throw new OwnerAuthError('signature already used');
}

/** True if `signature` over `message` comes from `owner` (EOA, or ERC-1271 smart account on Base Sepolia). */
export async function signedBy(owner: string, message: string, signature: string) {
  try {
    if (ethers.verifyMessage(message, signature).toLowerCase() === owner.toLowerCase()) return true;
  } catch {
    // not an EOA signature; try ERC-1271 below
  }
  try {
    const provider = getBaseSepoliaProvider();
    if ((await provider.getCode(owner)) === '0x') return false;
    const data = ERC1271.encodeFunctionData('isValidSignature', [ethers.hashMessage(message), signature]);
    const res = await provider.call({ to: owner, data });
    return res.slice(0, 10).toLowerCase() === '0x1626ba7e';
  } catch {
    return false;
  }
}

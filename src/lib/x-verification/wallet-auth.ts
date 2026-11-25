/** Server-only: check a wallet-signed link/unlink request (fresh, signed by the address, used once). */
import { createHash } from 'node:crypto';
import { ethers } from 'ethers';
import { signedBy } from '@/lib/agent-accounts/owner-auth';
import { agentStore } from '@/lib/agent-accounts/store';
import { xLinkMessage, type XLinkAction } from './message';

const MAX_AGE_MS = 10 * 60 * 1000;

export class WalletAuthError extends Error {}

export async function verifyWalletRequest(action: XLinkAction, body: { address?: unknown; issuedAt?: unknown; signature?: unknown }) {
  const { address, issuedAt, signature } = body;
  if (typeof address !== 'string' || !ethers.isAddress(address)) throw new WalletAuthError('valid wallet address required');
  if (typeof signature !== 'string' || !signature.startsWith('0x')) throw new WalletAuthError('wallet signature required');
  const issued = typeof issuedAt === 'string' ? Date.parse(issuedAt) : NaN;
  if (!Number.isFinite(issued) || Date.now() - issued > MAX_AGE_MS || issued - Date.now() > 60_000) {
    throw new WalletAuthError('signature expired, sign again');
  }
  const message = xLinkMessage({ action, address, issuedAt: issuedAt as string });
  if (!(await signedBy(address, message, signature))) throw new WalletAuthError('signature does not match wallet');
  const id = createHash('sha256').update(signature.toLowerCase()).digest('hex');
  if (!(await agentStore().claimOnce(`xsig:${id}`, Math.ceil(MAX_AGE_MS / 1000) + 120))) {
    throw new WalletAuthError('signature already used');
  }
  return address.toLowerCase();
}

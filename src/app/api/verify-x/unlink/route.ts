import { NextRequest, NextResponse } from 'next/server';
import { verifyWalletRequest, WalletAuthError } from '@/lib/x-verification/wallet-auth';
import { xLinks } from '@/lib/x-verification/store';

export const dynamic = 'force-dynamic';

/** POST /api/verify-x/unlink { address, issuedAt, signature } : delete the wallet's X link (signed by the wallet). */
export async function POST(req: NextRequest) {
  try {
    const address = await verifyWalletRequest('unlink', await req.json().catch(() => ({})));
    const removed = await xLinks.remove(address);
    return NextResponse.json({ removed });
  } catch (e) {
    if (e instanceof WalletAuthError) return NextResponse.json({ error: e.message }, { status: 401 });
    console.error('[verify-x] unlink failed', e);
    return NextResponse.json({ error: 'Could not remove the link' }, { status: 500 });
  }
}

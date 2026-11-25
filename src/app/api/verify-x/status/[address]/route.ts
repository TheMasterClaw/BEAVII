import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { xLinks } from '@/lib/x-verification/store';

export const dynamic = 'force-dynamic';

/** GET /api/verify-x/status/:address : the X account linked to a wallet, if any (public). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!ethers.isAddress(address)) return NextResponse.json({ error: 'invalid wallet address' }, { status: 400 });
  try {
    const link = await xLinks.byAddress(address);
    if (!link) return NextResponse.json({ verified: false });
    return NextResponse.json({
      verified: true,
      username: link.username,
      name: link.name,
      xId: link.xId,
      verifiedAt: new Date(link.verifiedAt).toISOString(),
    });
  } catch (e) {
    console.error('[verify-x] status failed', e);
    return NextResponse.json({ error: 'verification store unavailable' }, { status: 503 });
  }
}

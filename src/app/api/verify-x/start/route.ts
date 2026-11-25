import { NextRequest, NextResponse } from 'next/server';
import { verifyWalletRequest, WalletAuthError } from '@/lib/x-verification/wallet-auth';
import {
  PENDING_TTL_SEC,
  X_COOKIE,
  X_COOKIE_PATH,
  XConfigError,
  authorizeUrl,
  newPkce,
  sealPending,
  xConfig,
} from '@/lib/x-verification/oauth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/verify-x/start { address, issuedAt, signature }
 * The wallet proves ownership by signing xLinkMessage('link'); we answer with X's authorize URL and set the
 * signed PKCE cookie that /api/verify-x/callback checks.
 */
export async function POST(req: NextRequest) {
  try {
    const cfg = xConfig(req.nextUrl.origin);
    const address = await verifyWalletRequest('link', await req.json().catch(() => ({})));
    const { verifier, challenge, state } = newPkce();
    const res = NextResponse.json({ url: authorizeUrl(cfg, state, challenge) });
    res.cookies.set(X_COOKIE, sealPending(cfg.secret, { state, verifier, address, exp: Date.now() + PENDING_TTL_SEC * 1000 }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', // the callback is a top-level redirect back from x.com
      path: X_COOKIE_PATH,
      maxAge: PENDING_TTL_SEC,
    });
    return res;
  } catch (e) {
    if (e instanceof XConfigError) return NextResponse.json({ error: e.message }, { status: 503 });
    if (e instanceof WalletAuthError) return NextResponse.json({ error: e.message }, { status: 401 });
    console.error('[verify-x] start failed', e);
    return NextResponse.json({ error: 'Could not start X verification' }, { status: 500 });
  }
}

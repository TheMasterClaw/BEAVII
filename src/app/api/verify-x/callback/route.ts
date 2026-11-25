import { NextRequest, NextResponse } from 'next/server';
import { xLinks } from '@/lib/x-verification/store';
import { X_COOKIE, X_COOKIE_PATH, exchangeCode, fetchMe, openPending, revokeToken, xConfig } from '@/lib/x-verification/oauth';

export const dynamic = 'force-dynamic';

/** GET /api/verify-x/callback?code&state : X redirects here after the user approves (or cancels). */
export async function GET(req: NextRequest) {
  const back = (status: 'success' | 'error', message?: string) => {
    const url = new URL('/verify', req.nextUrl.origin);
    url.searchParams.set('x', status);
    if (message) url.searchParams.set('message', message);
    const res = NextResponse.redirect(url);
    res.cookies.set(X_COOKIE, '', { path: X_COOKIE_PATH, maxAge: 0 });
    return res;
  };

  try {
    const cfg = xConfig(req.nextUrl.origin);
    const q = req.nextUrl.searchParams;
    if (q.get('error')) return back('error', q.get('error') === 'access_denied' ? 'You cancelled the X sign-in' : 'X sign-in failed');

    const pending = openPending(cfg.secret, req.cookies.get(X_COOKIE)?.value);
    const code = q.get('code');
    if (!pending || !code || q.get('state') !== pending.state) {
      return back('error', 'This sign-in link expired or was opened in another browser. Start again.');
    }

    const token = await exchangeCode(cfg, code, pending.verifier);
    let me;
    try {
      me = await fetchMe(token);
    } finally {
      await revokeToken(cfg, token);
    }

    await xLinks.save({ address: pending.address, xId: me.id, username: me.username, name: me.name, verifiedAt: Date.now() });
    console.log(`[verify-x] linked ${pending.address} -> @${me.username}`);
    return back('success');
  } catch (e) {
    console.error('[verify-x] callback failed', e);
    return back('error', 'Could not verify with X. Try again.');
  }
}

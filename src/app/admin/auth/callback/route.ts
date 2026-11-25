import { NextRequest, NextResponse } from 'next/server';
import { exchangeAdminLink } from '@/lib/admin/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Magic-link landing: Supabase redirects here with ?code=<PKCE auth code> (or ?error_description=...). */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const back = new URL('/admin', url);
  const code = url.searchParams.get('code');
  if (!code) {
    back.searchParams.set('error', url.searchParams.get('error_description') ?? 'Sign-in link is missing its code.');
    return NextResponse.redirect(back);
  }
  const res = await exchangeAdminLink(code);
  if (!res.ok) back.searchParams.set('error', res.error);
  return NextResponse.redirect(back);
}

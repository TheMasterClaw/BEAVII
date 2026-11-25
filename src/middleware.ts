import { NextRequest, NextResponse } from 'next/server';

/**
 * Geo-restriction. On mainnet, Coinbase tokenized stocks are only for eligible persons outside the US,
 * and comprehensively sanctioned jurisdictions are blocked. Countries and regions come from Vercel's
 * x-vercel-ip-country / x-vercel-ip-country-region headers.
 *
 * Env (all optional):
 *   BLOCKED_COUNTRIES   comma list of ISO-3166 alpha-2 codes (default on mainnet: US,CU,IR,KP,SY; testnet: none)
 *   BLOCKED_REGIONS     comma list of ISO-3166-2 codes (default on mainnet: UA-43,UA-14,UA-09 = Crimea, Donetsk, Luhansk)
 *   GEO_FAIL_CLOSED     "true" blocks requests with no country header (e.g. not behind Vercel)
 *
 * This is one control, not a compliance program: it is bypassable with a VPN, so pair it with Terms of
 * Service, onchain sanctions screening (ETFFactory.sanctionsList) and legal review.
 */
const MAINNET = process.env.NEXT_PUBLIC_NETWORK === 'base';
const list = (v: string | undefined, fallback: string) =>
  (v ?? fallback)
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

const BLOCKED_COUNTRIES = new Set(list(process.env.BLOCKED_COUNTRIES, MAINNET ? 'US,CU,IR,KP,SY' : ''));
const BLOCKED_REGIONS = new Set(list(process.env.BLOCKED_REGIONS, MAINNET ? 'UA-43,UA-14,UA-09' : ''));
const FAIL_CLOSED = process.env.GEO_FAIL_CLOSED === 'true';

export function middleware(req: NextRequest) {
  if (!BLOCKED_COUNTRIES.size && !BLOCKED_REGIONS.size && !FAIL_CLOSED) return NextResponse.next();
  const country = req.headers.get('x-vercel-ip-country')?.toUpperCase();
  const region = req.headers.get('x-vercel-ip-country-region')?.toUpperCase();
  const blocked =
    (country && BLOCKED_COUNTRIES.has(country)) ||
    (country && region && BLOCKED_REGIONS.has(`${country}-${region}`)) ||
    (!country && FAIL_CLOSED);
  if (!blocked) return NextResponse.next();

  const message = 'BEAVII is not available in your region.';
  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: message }, { status: 451 });
  }
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not available</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:20vh auto;padding:0 1rem;line-height:1.5"><h1>Not available in your region</h1><p>${message} Tokenized stocks are offered only to eligible persons in permitted jurisdictions.</p></body></html>`,
    { status: 451, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

export const config = {
  // Everything except static assets and the health check (so uptime monitors anywhere can reach it)
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/health|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)'],
};

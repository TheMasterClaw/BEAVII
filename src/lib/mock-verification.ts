import { NextResponse } from 'next/server';

/**
 * The Twitter verification routes are mocks: no wallet signature, a hardcoded tweet, random "attestation" tx hashes
 * (audit F-12). They run in local dev, and in production only with ENABLE_MOCK_VERIFICATION=true.
 * Returns a 404 response when disabled, otherwise null.
 */
export function mockVerificationDisabled(): NextResponse | null {
  if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_MOCK_VERIFICATION === 'true') return null;
  return NextResponse.json({ error: 'Twitter verification is not available yet' }, { status: 404 });
}

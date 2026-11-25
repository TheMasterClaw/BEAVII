/**
 * Server-only: "Sign in with X" (OAuth 2.0 Authorization Code + PKCE), used only to learn which X account the user
 * controls. Scopes are read-only (users.read needs tweet.read); the access token is revoked as soon as /2/users/me
 * has been read, and nothing from X is stored except id, handle and display name.
 *
 * The PKCE verifier, state and wallet address travel in an HttpOnly cookie signed with X_VERIFY_SECRET, so the
 * pending step needs no database.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const REVOKE_URL = 'https://api.x.com/2/oauth2/revoke';
const ME_URL = 'https://api.x.com/2/users/me';
const SCOPES = 'users.read tweet.read';

export const X_COOKIE = 'beavii_x_oauth';
export const X_COOKIE_PATH = '/api/verify-x';
export const PENDING_TTL_SEC = 10 * 60;

export class XConfigError extends Error {}

export function xConfig(origin: string) {
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET || undefined; // unset for a "public" (native/SPA) X app
  const secret = process.env.X_VERIFY_SECRET;
  if (!clientId || !secret || secret.length < 32) {
    throw new XConfigError('X verification is not configured (set X_CLIENT_ID and a 32+ char X_VERIFY_SECRET)');
  }
  const redirectUri = process.env.X_REDIRECT_URI || `${origin}/api/verify-x/callback`;
  return { clientId, clientSecret, secret, redirectUri };
}

const b64url = (b: Buffer) => b.toString('base64url');

export function newPkce() {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge, state: b64url(randomBytes(16)) };
}

export function authorizeUrl(cfg: ReturnType<typeof xConfig>, state: string, challenge: string) {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `${AUTHORIZE_URL}?${q.toString().replace(/\+/g, '%20')}`; // X's docs encode the scope space as %20
}

// ---------------------------------------------------------------- signed pending-state cookie
export type Pending = { state: string; verifier: string; address: string; exp: number };

const mac = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('base64url');

export function sealPending(secret: string, p: Pending) {
  const body = b64url(Buffer.from(JSON.stringify(p)));
  return `${body}.${mac(secret, body)}`;
}

export function openPending(secret: string, raw: string | undefined): Pending | null {
  if (!raw) return null;
  const [body, sig] = raw.split('.');
  if (!body || !sig) return null;
  const want = Buffer.from(mac(secret, body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Pending;
    return p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- X API calls
function clientAuth(cfg: ReturnType<typeof xConfig>, form: URLSearchParams): HeadersInit {
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (cfg.clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`;
  } else {
    form.set('client_id', cfg.clientId);
  }
  return headers;
}

export async function exchangeCode(cfg: ReturnType<typeof xConfig>, code: string, verifier: string) {
  const form = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri, code_verifier: verifier });
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: clientAuth(cfg, form), body: form, cache: 'no-store' });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) throw new Error(`X token exchange failed: ${body.error_description || body.error || res.status}`);
  return body.access_token;
}

export async function fetchMe(accessToken: string) {
  const res = await fetch(ME_URL, { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
  const body = (await res.json().catch(() => ({}))) as { data?: { id: string; username: string; name: string }; title?: string; detail?: string };
  if (!res.ok || !body.data?.id) throw new Error(`X profile lookup failed: ${body.detail || body.title || res.status}`);
  return body.data;
}

/** Best effort: we only needed the token for one call. */
export async function revokeToken(cfg: ReturnType<typeof xConfig>, accessToken: string) {
  const form = new URLSearchParams({ token: accessToken, token_type_hint: 'access_token' });
  await fetch(REVOKE_URL, { method: 'POST', headers: clientAuth(cfg, form), body: form, cache: 'no-store' }).catch(() => undefined);
}

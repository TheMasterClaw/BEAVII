/**
 * Server-only admin gate for /admin. Exactly one person is allowed: ADMIN_EMAIL, proven by a Supabase Auth email
 * one-time code (or the magic link in the same email).
 *
 * - Enabled only when ADMIN_SECRET (>= 24 chars, signs sessions) and Supabase URL + anon key are set. Otherwise
 *   /admin is a 404: fail closed.
 * - Codes are only ever requested for ADMIN_EMAIL; any other address gets the same neutral reply and no email.
 * - After Supabase confirms the code, the verified email is checked again, then an HttpOnly, SameSite=Strict cookie
 *   `<expiry>.<HMAC(secret, email, expiry)>` is set. Rotating ADMIN_SECRET signs every session out.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies, headers } from 'next/headers';

/** The only account that can open /admin. Change it here, in code review, not via env. */
export const ADMIN_EMAIL = 'ericnans@gmail.com';

export const ADMIN_COOKIE = 'beavii_admin';
const PKCE_COOKIE = 'beavii_admin_pkce';
const SESSION_MS = 12 * 60 * 60 * 1000;
const MIN_SECRET_LEN = 24;

function secret(): string | null {
  const s = process.env.ADMIN_SECRET ?? '';
  return s.length >= MIN_SECRET_LEN ? s : null;
}

function supabase() {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
  return url && key ? { url, key } : null;
}

export const adminEnabled = () => secret() !== null && supabase() !== null;

const normEmail = (e: string) => e.trim().toLowerCase();
const sign = (s: string, exp: number) => createHmac('sha256', s).update(`beavii-admin-session:v2:${ADMIN_EMAIL}:${exp}`).digest('base64url');

function safeEqual(a: string, b: string) {
  // Hash first so lengths always match and the compare leaks nothing about length.
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

/** True when the request carries a valid, unexpired admin session cookie. */
export async function isAdminSession(): Promise<boolean> {
  const s = secret();
  if (!s || !supabase()) return false;
  const raw = (await cookies()).get(ADMIN_COOKIE)?.value ?? '';
  const [expStr, sig] = raw.split('.');
  const exp = Number(expStr);
  if (!sig || !Number.isFinite(exp) || exp < Date.now()) return false;
  return safeEqual(sig, sign(s, exp));
}

// ---------------------------------------------------------------- throttles (per server instance)
const WINDOW_MS = 15 * 60 * 1000;
const buckets = new Map<string, number[]>();

/** Records a hit; returns minutes to wait if the bucket is already full. */
function throttle(key: string, max: number, windowMs = WINDOW_MS): number | null {
  const now = Date.now();
  const recent = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) return Math.ceil((recent[0] + windowMs - now) / 60_000);
  recent.push(now);
  buckets.set(key, recent);
  return null;
}

async function requestMeta() {
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || 'unknown';
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return { ip, origin: `${proto}://${host}` };
}

const cookieBase = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/admin' };

// ---------------------------------------------------------------- Supabase Auth (GoTrue REST)
type GoTrueUser = { email?: string; email_confirmed_at?: string | null };
type GoTrueSession = { access_token?: string; user?: GoTrueUser };

async function gotrue<T>(path: string, body: unknown): Promise<{ ok: boolean; data: T; status: number }> {
  const sb = supabase()!;
  const res = await fetch(`${sb.url}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: sb.key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, data, status: res.status };
}

/** Best effort: end the Supabase session; /admin keeps its own cookie. */
async function supabaseSignOut(accessToken?: string) {
  if (!accessToken) return;
  const sb = supabase()!;
  await fetch(`${sb.url}/auth/v1/logout`, { method: 'POST', headers: { apikey: sb.key, Authorization: `Bearer ${accessToken}` } }).catch(() => undefined);
}

async function startSession(session: GoTrueSession, ip: string): Promise<LoginResult> {
  const s = secret()!;
  const user = session.user;
  if (!user?.email || normEmail(user.email) !== ADMIN_EMAIL || !user.email_confirmed_at) {
    console.warn(`[admin] verified non-admin account from ${ip}`);
    await supabaseSignOut(session.access_token);
    return { ok: false, error: 'This account cannot open admin.' };
  }
  await supabaseSignOut(session.access_token);
  const exp = Date.now() + SESSION_MS;
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, `${exp}.${sign(s, exp)}`, { ...cookieBase, sameSite: 'strict', maxAge: SESSION_MS / 1000 });
  jar.delete({ name: PKCE_COOKIE, path: '/admin' });
  console.info(`[admin] login ${ADMIN_EMAIL} from ${ip}`);
  return { ok: true };
}

export type LoginResult = { ok: true } | { ok: false; error: string };

/** Step 1: email a one-time code (and magic link) — only to ADMIN_EMAIL. The reply never reveals who is admin. */
export async function requestAdminCode(email: string): Promise<LoginResult> {
  if (!adminEnabled()) return { ok: false, error: 'Admin is disabled.' };
  const { ip, origin } = await requestMeta();
  const wait = throttle(`send:${ip}`, 3);
  if (wait) return { ok: false, error: `Too many requests. Try again in ${wait} min.` };

  if (normEmail(email) !== ADMIN_EMAIL) {
    console.warn(`[admin] code requested for non-admin email from ${ip}`);
    return { ok: true };
  }
  // Global cap so nobody can flood the admin inbox from many IPs.
  const globalWait = throttle('send:global', 5, 60 * 60 * 1000);
  if (globalWait) return { ok: true };

  // PKCE so the magic link in the same email can complete sign-in on /admin/auth/callback.
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  (await cookies()).set(PKCE_COOKIE, verifier, { ...cookieBase, maxAge: 15 * 60 });

  const redirect = encodeURIComponent(`${origin}/admin/auth/callback`);
  const res = await gotrue<{ msg?: string; error_description?: string }>(`otp?redirect_to=${redirect}`, {
    email: ADMIN_EMAIL,
    create_user: true,
    code_challenge: challenge,
    code_challenge_method: 's256',
  });
  if (!res.ok) {
    console.error(`[admin] Supabase OTP request failed (${res.status}): ${res.data.msg ?? res.data.error_description ?? ''}`);
    return { ok: false, error: res.status === 429 ? 'Email rate limit reached. Try again later.' : 'Could not send the code. Check the server logs.' };
  }
  return { ok: true };
}

/** Step 2a: the 6-digit code typed into /admin. */
export async function verifyAdminCode(email: string, code: string): Promise<LoginResult> {
  if (!adminEnabled()) return { ok: false, error: 'Admin is disabled.' };
  const { ip } = await requestMeta();
  const wait = throttle(`verify:${ip}`, 5);
  if (wait) return { ok: false, error: `Too many attempts. Try again in ${wait} min.` };
  const token = code.replace(/\s/g, '');
  if (normEmail(email) !== ADMIN_EMAIL || !/^\d{6,10}$/.test(token)) return { ok: false, error: 'Invalid or expired code.' };

  const res = await gotrue<GoTrueSession>('verify', { type: 'email', email: ADMIN_EMAIL, token });
  if (!res.ok) {
    console.warn(`[admin] bad code from ${ip}`);
    return { ok: false, error: 'Invalid or expired code.' };
  }
  return startSession(res.data, ip);
}

/** Step 2b: the magic link (PKCE auth code) from the same email, via /admin/auth/callback. */
export async function exchangeAdminLink(authCode: string): Promise<LoginResult> {
  if (!adminEnabled()) return { ok: false, error: 'Admin is disabled.' };
  const { ip } = await requestMeta();
  const wait = throttle(`verify:${ip}`, 5);
  if (wait) return { ok: false, error: `Too many attempts. Try again in ${wait} min.` };
  const verifier = (await cookies()).get(PKCE_COOKIE)?.value;
  if (!verifier) return { ok: false, error: 'Open the link in the same browser you requested it from, or type the code instead.' };

  const res = await gotrue<GoTrueSession>('token?grant_type=pkce', { auth_code: authCode, code_verifier: verifier });
  if (!res.ok) return { ok: false, error: 'This link is invalid or expired. Request a new code.' };
  return startSession(res.data, ip);
}

export async function adminLogout() {
  (await cookies()).delete({ name: ADMIN_COOKIE, path: '/admin' });
}

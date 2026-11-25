/**
 * Server-only admin gate for /admin.
 *
 * - Enabled only when ADMIN_SECRET is set (>= 24 chars). Otherwise /admin is a 404: fail closed.
 * - Login compares the submitted secret in constant time and sets an HttpOnly, SameSite=Strict cookie holding
 *   `<expiry>.<HMAC(secret, expiry)>`. Rotating ADMIN_SECRET signs every session out.
 * - Login attempts are throttled per IP (per server instance).
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { cookies, headers } from 'next/headers';

export const ADMIN_COOKIE = 'beavii_admin';
const SESSION_MS = 12 * 60 * 60 * 1000;
const MIN_SECRET_LEN = 24;

function secret(): string | null {
  const s = process.env.ADMIN_SECRET ?? '';
  return s.length >= MIN_SECRET_LEN ? s : null;
}

export const adminEnabled = () => secret() !== null;

const sign = (s: string, exp: number) => createHmac('sha256', s).update(`beavii-admin-session:v1:${exp}`).digest('base64url');

function safeEqual(a: string, b: string) {
  // Hash first so lengths always match and the compare leaks nothing about length.
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** True when the request carries a valid, unexpired admin session cookie. */
export async function isAdminSession(): Promise<boolean> {
  const s = secret();
  if (!s) return false;
  const raw = (await cookies()).get(ADMIN_COOKIE)?.value ?? '';
  const [expStr, sig] = raw.split('.');
  const exp = Number(expStr);
  if (!sig || !Number.isFinite(exp) || exp < Date.now()) return false;
  return safeEqual(sig, sign(s, exp));
}

// ---------------------------------------------------------------- login throttle
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const attempts = new Map<string, number[]>();

async function clientIp() {
  const h = await headers();
  return (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || 'unknown';
}

export type LoginResult = { ok: true } | { ok: false; error: string };

export async function adminLogin(submitted: string): Promise<LoginResult> {
  const s = secret();
  if (!s) return { ok: false, error: 'Admin is disabled.' };

  const ip = await clientIp();
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_ATTEMPTS) {
    const wait = Math.ceil((recent[0] + WINDOW_MS - now) / 60_000);
    return { ok: false, error: `Too many attempts. Try again in ${wait} min.` };
  }

  if (!safeEqual(submitted, s)) {
    recent.push(now);
    attempts.set(ip, recent);
    console.warn(`[admin] failed login from ${ip}`);
    return { ok: false, error: 'Wrong secret.' };
  }

  attempts.delete(ip);
  const exp = now + SESSION_MS;
  (await cookies()).set(ADMIN_COOKIE, `${exp}.${sign(s, exp)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/admin',
    maxAge: SESSION_MS / 1000,
  });
  console.info(`[admin] login from ${ip}`);
  return { ok: true };
}

export async function adminLogout() {
  (await cookies()).delete({ name: ADMIN_COOKIE, path: '/admin' });
}

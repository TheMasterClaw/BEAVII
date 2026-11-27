/**
 * Server-only admin gate for /admin. Sign-in is the app's normal Reown login: connect (social login or any wallet),
 * then sign a one-time message. Only wallets in ADMIN_WALLETS get in.
 *
 * Reown gives each social/email account its own fixed wallet, so allowlisting the wallet Reown created for the admin's
 * Google account (EricNans@gmail.com) limits /admin to that account. The email itself is never visible to the server.
 *
 * - Enabled only when ADMIN_SECRET (>= 24 chars, signs nonces and sessions) and ADMIN_WALLETS are set; else 404.
 * - Signatures are checked with viem: EOAs, deployed smart accounts (ERC-1271) and not-yet-deployed smart accounts
 *   (ERC-6492), which is what Reown social logins can produce.
 * - Nonces are HMAC-signed, expire after 5 minutes and work once (per instance). Sessions last 12 hours, are bound to
 *   the signing address, and end as soon as that address is removed from ADMIN_WALLETS or ADMIN_SECRET rotates.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { createPublicClient, getAddress, http, isAddress, type Hex } from 'viem';
import { baseSepolia } from 'viem/chains';
import { BASE_SEPOLIA } from '@/config/base-sepolia';

export const ADMIN_COOKIE = 'beavii_admin';
const SESSION_MS = 12 * 60 * 60 * 1000;
const NONCE_MS = 5 * 60 * 1000;
const MIN_SECRET_LEN = 24;

function secret(): string | null {
  const s = process.env.ADMIN_SECRET ?? '';
  return s.length >= MIN_SECRET_LEN ? s : null;
}

/** Lowercased admin wallet addresses from ADMIN_WALLETS (comma or space separated). */
function adminWallets(): Set<string> {
  return new Set(
    (process.env.ADMIN_WALLETS ?? '')
      .split(/[\s,]+/)
      .map((a) => a.trim().toLowerCase())
      .filter((a) => isAddress(a)),
  );
}

export const adminEnabled = () => secret() !== null && adminWallets().size > 0;

const hmac = (s: string, data: string) => createHmac('sha256', s).update(data).digest('base64url');
function safeEqual(a: string, b: string) {
  // Hash first so lengths always match and the compare leaks nothing about length.
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

/** The admin address of a valid, unexpired session cookie, else null. */
export async function adminSessionAddress(): Promise<string | null> {
  const s = secret();
  if (!s) return null;
  const [expStr, addr, sig] = ((await cookies()).get(ADMIN_COOKIE)?.value ?? '').split('.');
  const exp = Number(expStr);
  if (!sig || !addr || !Number.isFinite(exp) || exp < Date.now()) return null;
  if (!safeEqual(sig, hmac(s, `beavii-admin-session:v3:${addr}:${exp}`))) return null;
  return adminWallets().has(addr) ? addr : null;
}
export const isAdminSession = async () => (await adminSessionAddress()) !== null;

// ---------------------------------------------------------------- sign-in message

async function requestMeta() {
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || 'unknown';
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost';
  return { ip, host };
}

function buildMessage(p: { address: string; host: string; nonce: string; issuedAt: string }) {
  return [
    'BEAVII admin sign-in',
    '',
    'Sign to open the admin console. This does not send a transaction or cost gas.',
    '',
    `Address: ${p.address}`,
    `Domain: ${p.host}`,
    `Chain: ${BASE_SEPOLIA.chainId}`,
    `Nonce: ${p.nonce}`,
    `Issued: ${p.issuedAt}`,
  ].join('\n');
}

export type ChallengeResult = { ok: true; message: string } | { ok: false; error: string };

/** Step 1: a fresh message for the connected address to sign. */
export async function adminChallenge(address: string): Promise<ChallengeResult> {
  const s = secret();
  if (!s || !adminEnabled()) return { ok: false, error: 'Admin is disabled.' };
  if (!isAddress(address)) return { ok: false, error: 'Connect a wallet first.' };
  const { host } = await requestMeta();
  const addr = address.toLowerCase();
  const exp = Date.now() + NONCE_MS;
  const rand = randomBytes(12).toString('base64url');
  const nonce = `${exp}.${rand}.${hmac(s, `beavii-admin-nonce:${addr}:${host}:${exp}:${rand}`)}`;
  return { ok: true, message: buildMessage({ address: addr, host, nonce, issuedAt: new Date().toISOString() }) };
}

// ---------------------------------------------------------------- verify + session

const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map<string, number[]>();
const usedNonces = new Map<string, number>();

const makeClient = () => createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL || BASE_SEPOLIA.rpcUrl) });
let client: ReturnType<typeof makeClient> | null = null;
const publicClient = () => (client ??= makeClient());

export type LoginResult = { ok: true } | { ok: false; error: string };

/** Step 2: check the signed message and, for an admin wallet, start a session. */
export async function adminSignIn(message: string, signature: string): Promise<LoginResult> {
  const s = secret();
  if (!s || !adminEnabled()) return { ok: false, error: 'Admin is disabled.' };
  const { ip, host } = await requestMeta();

  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= 10) return { ok: false, error: `Too many attempts. Try again in ${Math.ceil((recent[0] + WINDOW_MS - now) / 60_000)} min.` };
  recent.push(now);
  attempts.set(ip, recent);

  // The message must be exactly one we issued: rebuild it from its fields and compare.
  const field = (k: string) => new RegExp(`^${k}: (.+)$`, 'm').exec(message)?.[1] ?? '';
  const addr = field('Address').toLowerCase();
  const nonce = field('Nonce');
  const issuedAt = field('Issued');
  const [expStr, rand, mac] = nonce.split(".");
  const exp = Number(expStr);
  const fail = { ok: false as const, error: 'Sign-in failed. Request a new message and try again.' };
  if (!isAddress(addr) || !rand || !mac || !Number.isFinite(exp) || exp < now) return { ok: false, error: 'This sign-in request expired. Try again.' };
  if (message !== buildMessage({ address: addr, host, nonce, issuedAt })) return fail;
  if (!safeEqual(mac, hmac(s, `beavii-admin-nonce:${addr}:${host}:${exp}:${rand}`))) return fail;

  for (const [k, e] of usedNonces) if (e < now) usedNonces.delete(k);
  if (usedNonces.has(nonce)) return fail;

  if (!/^0x[0-9a-fA-F]+$/.test(signature)) return fail;
  let valid = false;
  try {
    valid = await publicClient().verifyMessage({ address: getAddress(addr), message, signature: signature as Hex });
  } catch (e) {
    console.error('[admin] signature check failed', e instanceof Error ? e.message : e);
    return { ok: false, error: 'Could not check the signature (RPC error). Try again.' };
  }
  if (!valid) return fail;
  usedNonces.set(nonce, exp);

  if (!adminWallets().has(addr)) {
    console.warn(`[admin] non-admin wallet ${addr} signed in from ${ip}`);
    return { ok: false, error: 'This account cannot open admin.' };
  }

  attempts.delete(ip);
  const sessionExp = now + SESSION_MS;
  (await cookies()).set(ADMIN_COOKIE, `${sessionExp}.${addr}.${hmac(s, `beavii-admin-session:v3:${addr}:${sessionExp}`)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/admin',
    maxAge: SESSION_MS / 1000,
  });
  console.info(`[admin] login ${addr} from ${ip}`);
  return { ok: true };
}

export async function adminLogout() {
  (await cookies()).delete({ name: ADMIN_COOKIE, path: '/admin' });
}

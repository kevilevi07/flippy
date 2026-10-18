// Super simple admin auth: env-based credentials + a signed session cookie.

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE = "trupx_admin";
export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours

function adminUser(): string {
  return (process.env.ADMIN_USERNAME ?? "admin").trim();
}
function adminPass(): string {
  return (process.env.ADMIN_PASSWORD ?? "").trim();
}
function sessionSecret(): string {
  // Reuse the CLI token as the signing key when no dedicated secret is set.
  return (
    process.env.ADMIN_SESSION_SECRET ??
    process.env.CLI_TOKEN ??
    "trupx-dev-secret"
  );
}

export function isAdminConfigured(): boolean {
  return adminUser().length > 0 && adminPass().length > 0;
}

export function verifyAdminCredentials(user: string, pass: string): boolean {
  const u = adminUser();
  const p = adminPass();
  if (!u || !p) return false;
  const au = Buffer.from(user);
  const bu = Buffer.from(u);
  const ap = Buffer.from(pass);
  const bp = Buffer.from(p);
  const userOk = au.length === bu.length && timingSafeEqual(au, bu);
  const passOk = ap.length === bp.length && timingSafeEqual(ap, bp);
  return userOk && passOk;
}

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("hex");
}

/**
 * Mint a session token: `<expires>.<nonce>.<signature>`.
 * No DB write — fully stateless.
 */
export function mintSession(): string {
  const exp = Math.floor(Date.now() / 1000) + ADMIN_SESSION_TTL_SECONDS;
  const nonce = randomBytes(8).toString("hex");
  const payload = `${exp}.${nonce}`;
  return `${payload}.${sign(payload)}`;
}

function verifySession(tok: string): boolean {
  const parts = tok.split(".");
  if (parts.length !== 3) return false;
  const [expStr, nonce, sig] = parts;
  const payload = `${expStr}.${nonce}`;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const exp = parseInt(expStr, 10);
  if (!Number.isFinite(exp)) return false;
  return Math.floor(Date.now() / 1000) < exp;
}

export async function isAdmin(): Promise<boolean> {
  const jar = await cookies();
  const sid = jar.get(ADMIN_COOKIE)?.value;
  if (!sid) return false;
  return verifySession(sid);
}

export async function setAdminCookie(sid: string): Promise<void> {
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, sid, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  });
}

export async function clearAdminCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, "", { path: "/", maxAge: 0 });
}

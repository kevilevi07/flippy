// Admin auth. Credentials come from env; sessions live in Redis under a
// separate cookie so admins and users can't accidentally mix states.

import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { kv } from "./db";
import { randomToken } from "./auth";

const ADMIN_COOKIE = "flippy_admin";
const ADMIN_SESSION_TTL = 60 * 60 * 2; // 2 hours

function envUser(): string {
  return (process.env.ADMIN_USERNAME ?? "").trim();
}
function envPass(): string {
  return (process.env.ADMIN_PASSWORD ?? "").trim();
}

export function adminConfigured(): boolean {
  return envUser().length > 0 && envPass().length > 0;
}

export function verifyAdminCredentials(user: string, pass: string): boolean {
  const u = envUser();
  const p = envPass();
  if (!u || !p) return false;
  const au = Buffer.from(user);
  const bu = Buffer.from(u);
  const ap = Buffer.from(pass);
  const bp = Buffer.from(p);
  // timingSafeEqual requires equal length — pad check first.
  const userOk = au.length === bu.length && timingSafeEqual(au, bu);
  const passOk = ap.length === bp.length && timingSafeEqual(ap, bp);
  return userOk && passOk;
}

export async function createAdminSession(): Promise<string> {
  const sid = randomToken(32);
  await kv.set(`admin_session:${sid}`, "1", ADMIN_SESSION_TTL);
  return sid;
}

export async function destroyAdminSession(sid: string): Promise<void> {
  await kv.delete(`admin_session:${sid}`);
}

export async function isAdmin(): Promise<boolean> {
  const jar = await cookies();
  const sid = jar.get(ADMIN_COOKIE)?.value;
  if (!sid) return false;
  const ok = await kv.get(`admin_session:${sid}`);
  return ok === "1";
}

export async function setAdminCookie(sid: string): Promise<void> {
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, sid, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: ADMIN_SESSION_TTL,
  });
}

export async function clearAdminCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, "", { path: "/", maxAge: 0 });
}

export { ADMIN_COOKIE };

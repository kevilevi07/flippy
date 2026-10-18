import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { kv, sets } from "./db";

const SESSION_COOKIE = "flippy_session";
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days
const TOKEN_TTL = 60 * 60 * 24 * 365; // 1 year

export type UserRecord = {
  id: string;
  email: string;
  password_hash: string; // scrypt: "<salt_hex>:<hash_hex>"
  flippy_token: string;
  created_at: number;
};

// ---------- password hashing (scrypt) ----------

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ---------- opaque tokens ----------

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

// ---------- user store ----------

export async function createUser(email: string, password: string): Promise<UserRecord> {
  const emailKey = `email:${email.toLowerCase()}`;
  const existing = await kv.get(emailKey);
  if (existing) throw new Error("email already registered");

  const user: UserRecord = {
    id: randomToken(8),
    email: email.toLowerCase(),
    password_hash: hashPassword(password),
    flippy_token: `fly_${randomToken(24)}`,
    created_at: Date.now(),
  };
  await kv.set(`user:${user.id}`, JSON.stringify(user));
  await kv.set(emailKey, user.id);
  await kv.set(`token:${user.flippy_token}`, user.id, TOKEN_TTL);
  await sets.add("users", user.id);
  return user;
}

export async function listAllUsers(): Promise<UserRecord[]> {
  const ids = await sets.members("users");
  if (ids.length === 0) return [];
  const results: UserRecord[] = [];
  for (const id of ids) {
    const u = await userById(id);
    if (u) results.push(u);
  }
  results.sort((a, b) => b.created_at - a.created_at);
  return results;
}

export async function deleteUser(id: string): Promise<boolean> {
  const user = await userById(id);
  if (!user) return false;
  const tunnelIds: string[] = await sets.members(`user:${id}:tunnels`);
  await kv.delete(`user:${id}`);
  await kv.delete(`email:${user.email}`);
  await kv.delete(`token:${user.flippy_token}`);
  await sets.removeKey(`user:${id}:tunnels`);
  for (const t of tunnelIds) await kv.delete(`tunnel:${t}`);
  await sets.remove("users", id);
  return true;
}

export async function resetToken(id: string): Promise<string | null> {
  const user = await userById(id);
  if (!user) return null;
  const newTok = `fly_${randomToken(24)}`;
  await kv.delete(`token:${user.flippy_token}`);
  user.flippy_token = newTok;
  await kv.set(`user:${id}`, JSON.stringify(user));
  await kv.set(`token:${newTok}`, id, TOKEN_TTL);
  return newTok;
}

export async function userByEmail(email: string): Promise<UserRecord | null> {
  const id = await kv.get(`email:${email.toLowerCase()}`);
  if (!id) return null;
  return userById(id);
}

export async function userById(id: string): Promise<UserRecord | null> {
  const raw = await kv.get(`user:${id}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserRecord;
  } catch {
    return null;
  }
}

/**
 * Validate a flippy CLI token. Returns the owning user id or null.
 */
export async function userIdFromToken(token: string): Promise<string | null> {
  return await kv.get(`token:${token}`);
}

// ---------- sessions (browser) ----------

export async function createSession(userId: string): Promise<string> {
  const sid = randomToken(32);
  await kv.set(`session:${sid}`, userId, SESSION_TTL);
  return sid;
}

export async function destroySession(sid: string): Promise<void> {
  await kv.delete(`session:${sid}`);
}

export async function sessionUserId(): Promise<string | null> {
  const jar = await cookies();
  const sid = jar.get(SESSION_COOKIE)?.value;
  if (!sid) return null;
  return await kv.get(`session:${sid}`);
}

export async function setSessionCookie(sid: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, sid, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: SESSION_TTL,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
}

export { SESSION_COOKIE };

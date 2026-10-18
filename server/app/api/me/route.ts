import { sessionUserId, userById } from "@/lib/auth";
import { keys, redis } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: "not signed in" }, { status: 401 });
  const user = await userById(uid);
  if (!user) return Response.json({ error: "user missing" }, { status: 401 });

  // List live tunnels for this user. We keep `user:<uid>:tunnels` as a set,
  // but entries expire via tunnel TTL — filter against actual existence.
  const tids = await redis().smembers(keys.userTunnels(uid));
  const alive: string[] = [];
  for (const t of tids) {
    if ((await redis().exists(keys.tunnel(t))) === 1) alive.push(t);
    else await redis().srem(keys.userTunnels(uid), t);
  }
  return Response.json({
    id: user.id,
    email: user.email,
    flippy_token: user.flippy_token,
    created_at: user.created_at,
    tunnels: alive,
  });
}

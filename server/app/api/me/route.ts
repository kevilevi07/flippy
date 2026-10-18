import { sessionUserId, userById } from "@/lib/auth";
import { keys, kv, sets } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: "not signed in" }, { status: 401 });
  const user = await userById(uid);
  if (!user) return Response.json({ error: "user missing" }, { status: 401 });

  const tids = await sets.members(keys.userTunnels(uid));
  const alive: string[] = [];
  for (const t of tids) {
    if (await kv.exists(keys.tunnel(t))) alive.push(t);
    else await sets.remove(keys.userTunnels(uid), t);
  }
  return Response.json({
    id: user.id,
    email: user.email,
    flippy_token: user.flippy_token,
    created_at: user.created_at,
    tunnels: alive,
  });
}

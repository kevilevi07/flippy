import { cookies } from "next/headers";
import { clearSessionCookie, destroySession, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const jar = await cookies();
  const sid = jar.get(SESSION_COOKIE)?.value;
  if (sid) await destroySession(sid);
  await clearSessionCookie();
  return Response.json({ ok: true });
}

import { cookies } from "next/headers";
import {
  ADMIN_COOKIE,
  clearAdminCookie,
  destroyAdminSession,
} from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  const jar = await cookies();
  const sid = jar.get(ADMIN_COOKIE)?.value;
  if (sid) await destroyAdminSession(sid);
  await clearAdminCookie();
  return Response.json({ ok: true });
}

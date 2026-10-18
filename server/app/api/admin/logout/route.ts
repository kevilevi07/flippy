import { clearAdminCookie } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  await clearAdminCookie();
  return Response.json({ ok: true });
}

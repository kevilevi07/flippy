import {
  verifyAdminCredentials,
  mintSession,
  setAdminCookie,
  isAdminConfigured,
} from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!isAdminConfigured()) {
    return Response.json(
      { error: "admin not configured; set ADMIN_USERNAME + ADMIN_PASSWORD env vars" },
      { status: 500 },
    );
  }
  const body = (await req.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
  };
  const u = (body.username ?? "").trim();
  const p = (body.password ?? "").trim();
  if (!verifyAdminCredentials(u, p)) {
    return Response.json({ error: "invalid credentials" }, { status: 401 });
  }
  await setAdminCookie(mintSession());
  return Response.json({ ok: true });
}

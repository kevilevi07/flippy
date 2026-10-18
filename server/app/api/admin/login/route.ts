import {
  adminConfigured,
  createAdminSession,
  setAdminCookie,
  verifyAdminCredentials,
} from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!adminConfigured()) {
    return Response.json(
      { error: "admin not configured on this deployment" },
      { status: 503 },
    );
  }
  const { username, password } = (await req.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
  };
  if (!username || !password) {
    return Response.json({ error: "username and password required" }, { status: 400 });
  }
  if (!verifyAdminCredentials(username, password)) {
    return Response.json({ error: "invalid credentials" }, { status: 401 });
  }
  const sid = await createAdminSession();
  await setAdminCookie(sid);
  return Response.json({ ok: true });
}

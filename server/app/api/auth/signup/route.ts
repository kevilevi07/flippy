import {
  createUser,
  createSession,
  setSessionCookie,
  type UserRecord,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const { email, password } = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
  };
  if (!email || !password) {
    return Response.json({ error: "email and password required" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "invalid email" }, { status: 400 });
  }
  if (password.length < 8) {
    return Response.json({ error: "password must be at least 8 characters" }, { status: 400 });
  }
  let user: UserRecord;
  try {
    user = await createUser(email, password);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 409 });
  }
  const sid = await createSession(user.id);
  await setSessionCookie(sid);
  return Response.json({
    id: user.id,
    email: user.email,
    flippy_token: user.flippy_token,
  });
}

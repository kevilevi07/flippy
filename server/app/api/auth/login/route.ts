import {
  createSession,
  setSessionCookie,
  userByEmail,
  verifyPassword,
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
  const user = await userByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return Response.json({ error: "invalid credentials" }, { status: 401 });
  }
  const sid = await createSession(user.id);
  await setSessionCookie(sid);
  return Response.json({
    id: user.id,
    email: user.email,
    flippy_token: user.flippy_token,
  });
}

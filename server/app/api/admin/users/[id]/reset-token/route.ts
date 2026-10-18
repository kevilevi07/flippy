import { isAdmin } from "@/lib/admin-auth";
import { resetToken } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx): Promise<Response> {
  if (!(await isAdmin())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const tok = await resetToken(id);
  if (!tok) return Response.json({ error: "user not found" }, { status: 404 });
  return Response.json({ ok: true, flippy_token: tok });
}

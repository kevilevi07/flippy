import { isAdmin } from "@/lib/admin-auth";
import { deleteUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  if (!(await isAdmin())) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const ok = await deleteUser(id);
  if (!ok) return Response.json({ error: "user not found" }, { status: 404 });
  return Response.json({ ok: true });
}

// Serves prebuilt binaries at /bin/<asset>. We stream the body straight from
// the private release source so the GitHub URL never leaks to callers.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCE_BASE = "https://github.com/kevilevi07/flippy/releases/latest/download";

const ALLOWED = new Set([
  "flippy-linux-x64",
  "flippy-linux-arm64",
  "flippy-darwin-x64",
  "flippy-darwin-arm64",
  "flippy-windows-x64.exe",
]);

type Ctx = { params: Promise<{ asset: string }> };

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const { asset } = await ctx.params;
  if (!ALLOWED.has(asset)) {
    return new Response("not found", {
      status: 404,
      headers: { "content-type": "text/plain" },
    });
  }

  const upstream = await fetch(`${SOURCE_BASE}/${asset}`, { redirect: "follow" });
  if (!upstream.ok || !upstream.body) {
    return new Response(`upstream error: ${upstream.status}`, {
      status: 502,
      headers: { "content-type": "text/plain" },
    });
  }

  const headers = new Headers();
  headers.set("content-type", "application/octet-stream");
  headers.set("content-disposition", `attachment; filename="${asset}"`);
  headers.set("cache-control", "public, max-age=300");
  const len = upstream.headers.get("content-length");
  if (len) headers.set("content-length", len);
  const etag = upstream.headers.get("etag");
  if (etag) headers.set("etag", etag);

  return new Response(upstream.body, { status: 200, headers });
}

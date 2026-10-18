import { redirect } from "next/navigation";
import { isAdmin, isAdminConfigured } from "@/lib/admin";
import LoginForm from "./LoginForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Home() {
  if (await isAdmin()) redirect("/dashboard");

  return (
    <>
      <nav>
        <div className="brand">trupx</div>
      </nav>

      <div className="container" style={{ maxWidth: 420, marginTop: "2rem" }}>
        <div className="card">
          <h1 style={{ marginTop: 0 }}>Admin login</h1>
          {!isAdminConfigured() && (
            <p style={{ color: "#ff6b6b", fontSize: "0.9rem" }}>
              <code>ADMIN_USERNAME</code> + <code>ADMIN_PASSWORD</code> env vars
              are not set. Set them in your Vercel project and redeploy.
            </p>
          )}
          <LoginForm />
        </div>
      </div>
    </>
  );
}

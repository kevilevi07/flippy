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

      <div className="login-wrap">
        <div className="login-card">
          <h1>Admin login</h1>
          {!isAdminConfigured() && (
            <div className="err">
              <code>ADMIN_USERNAME</code> + <code>ADMIN_PASSWORD</code> env vars are not set.
              Configure them in your Vercel project and redeploy.
            </div>
          )}
          <LoginForm />
        </div>
      </div>
    </>
  );
}

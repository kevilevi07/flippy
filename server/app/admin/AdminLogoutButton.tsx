"use client";
import { useRouter } from "next/navigation";

export default function AdminLogoutButton() {
  const router = useRouter();
  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/");
  }
  return (
    <a href="#" onClick={(e) => { e.preventDefault(); void logout(); }}>
      Sign out
    </a>
  );
}

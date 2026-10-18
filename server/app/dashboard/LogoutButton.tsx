"use client";
import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
  }
  return (
    <a href="#" onClick={(e) => { e.preventDefault(); void logout(); }}>
      Sign out
    </a>
  );
}

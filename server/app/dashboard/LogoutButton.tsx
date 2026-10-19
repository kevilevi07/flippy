"use client";

export default function LogoutButton() {
  async function onClick() {
    await fetch("/api/admin/logout", { method: "POST" });
    window.location.href = "/";
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="btn-ghost"
      style={{ fontSize: "0.9rem" }}
    >
      Log out
    </button>
  );
}

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
      style={{
        padding: "0.4rem 0.9rem",
        borderRadius: 6,
        border: "1px solid #333",
        background: "transparent",
        color: "#eee",
        fontSize: "0.9rem",
        cursor: "pointer",
      }}
    >
      Log out
    </button>
  );
}

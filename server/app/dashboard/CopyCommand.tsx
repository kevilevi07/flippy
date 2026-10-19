"use client";

import { useState } from "react";

export default function CopyCommand({
  label,
  command,
}: {
  label: string;
  command: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(command);
      } else {
        const ta = document.createElement("textarea");
        ta.value = command;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div style={{ marginBottom: "1.25rem" }}>
      <div
        style={{
          fontSize: "0.8rem",
          opacity: 0.65,
          letterSpacing: 1,
          marginBottom: "0.4rem",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          gap: "0.5rem",
          background: "#0d0d10",
          border: "1px solid #222",
          borderRadius: 8,
          padding: "0.5rem 0.75rem",
        }}
      >
        <code
          style={{
            flex: 1,
            fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
            fontSize: "0.92rem",
            overflowX: "auto",
            whiteSpace: "nowrap",
            color: "#e2e8f0",
            padding: "0.3rem 0",
          }}
        >
          {command}
        </code>
        <button
          type="button"
          onClick={copy}
          style={{
            border: "1px solid #333",
            background: copied ? "#1a3b24" : "#1a1a1f",
            color: copied ? "#87d96c" : "#e2e8f0",
            borderRadius: 6,
            padding: "0.35rem 0.9rem",
            fontSize: "0.85rem",
            cursor: "pointer",
            whiteSpace: "nowrap",
            minWidth: 72,
            transition: "background 0.15s, color 0.15s",
          }}
          aria-label={`Copy ${label} install command`}
        >
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

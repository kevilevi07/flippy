"use client";
import { useState } from "react";

export default function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }
  return (
    <div className="token-row">
      <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
      <button className="btn copy-btn" onClick={copy} type="button">
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

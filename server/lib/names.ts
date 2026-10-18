// Rules for app names (first segment under /).

// Names reserved for the server's own routes/assets.
export const RESERVED_NAMES = new Set([
  "api",
  "_next",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
  "install.ps1",
  "install.sh",
  // Reserved for future top-level routes.
  "admin",
  "settings",
  "login",
  "logout",
  "dashboard",
  "signup",
  "download",
]);

// 2-32 chars: start/end alphanumeric; hyphens allowed only in the middle.
// Also accept a 1-char all-alphanumeric name (e.g. "x").
const NAME_RE = /^(?:[a-z0-9]|[a-z0-9][a-z0-9-]{0,30}[a-z0-9])$/;

export function isValidName(s: string | null | undefined): s is string {
  if (!s) return false;
  if (RESERVED_NAMES.has(s)) return false;
  return NAME_RE.test(s);
}

// Rules for app names (first segment under /app/).

// Only names that collide with the server's own paths are reserved.
export const RESERVED_NAMES = new Set([
  "api",
  "_next",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
  // Reserved for future top-level routes under /app/.
  "admin",
  "settings",
]);

// 2-32 chars: start/end alphanumeric; hyphens allowed only in the middle.
// Also accept a 1-char all-alphanumeric name (e.g. "x").
const NAME_RE = /^(?:[a-z0-9]|[a-z0-9][a-z0-9-]{0,30}[a-z0-9])$/;

export function isValidName(s: string | null | undefined): s is string {
  if (!s) return false;
  if (RESERVED_NAMES.has(s)) return false;
  return NAME_RE.test(s);
}

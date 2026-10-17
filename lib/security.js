import { isIP } from "node:net";

export function isBlockedHostname(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  return !host || host === "localhost" || host.endsWith(".localhost") ||
    host.endsWith(".local") || host.endsWith(".internal") ||
    host.endsWith(".test") || host.endsWith(".invalid");
}

export function isPublicIPv4(address) {
  const parts = String(address).split(".").map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  return !(
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 88 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

export function isPublicAddress(address) {
  const family = isIP(String(address));
  if (family === 4) return isPublicIPv4(address);
  if (family === 6) {
    const value = String(address).toLowerCase();
    const first = parseInt(value.split(":")[0] || "0", 16);
    return first >= 0x2000 && first <= 0x3fff && !value.startsWith("2001:db8:");
  }
  return false;
}

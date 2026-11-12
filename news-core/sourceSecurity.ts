import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const SEC_ALLOWED_HOSTS = new Set(["data.sec.gov", "www.sec.gov"]);
type AddressLookup = (hostname: string, options: { all: true }) => Promise<readonly { address: string; family: 4 | 6 }[]>;

function ipv4Value(address: string): number | null {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some(item => !Number.isInteger(item) || item < 0 || item > 255)) return null;
  return parts.reduce((value, item) => value * 256 + item, 0);
}

function ipv4NonGlobal(address: string): boolean {
  const value = ipv4Value(address); if (value === null) return true;
  const first = value >>> 24, second = (value >>> 16) & 255;
  return first === 0 || first === 10 || first === 127 || first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 0 || second === 168)) || (first === 192 && second === 2) ||
    (first === 192 && second === 88) || (first === 198 && (second === 18 || second === 19 || second === 51)) ||
    (first === 203 && second === 0);
}

function ipv6Value(address: string): bigint | null {
  const normalized = address.toLowerCase().split("%", 1)[0];
  if (isIP(normalized) !== 6) return null;
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":").filter(Boolean) : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":").filter(Boolean) : [];
  const groups = [...left, ...(halves.length === 2 ? Array(8 - left.length - right.length).fill("0") : []), ...right];
  if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt(parseInt(group, 16)), 0n);
}

function ipv6In(value: bigint, prefix: bigint, bits: number): boolean {
  const mask = ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits);
  return (value & mask) === prefix;
}

function privateAddress(address: string): boolean {
  if (isIP(address) === 4) return ipv4NonGlobal(address);
  const value = ipv6Value(address); if (value === null) return true;
  const mapped = ipv6In(value, 0xffffn << 32n, 96);
  if (mapped) {
    const mappedValue = Number(value & 0xffffffffn);
    return ipv4NonGlobal([mappedValue >>> 24, (mappedValue >>> 16) & 255, (mappedValue >>> 8) & 255, mappedValue & 255].join("."));
  }
  return value === 0n || value === 1n || ipv6In(value, 0xfc00n << 112n, 7) || ipv6In(value, 0xfe80n << 112n, 10) ||
    ipv6In(value, 0xff00n << 112n, 8) || ipv6In(value, 0x20010db8n << 96n, 32) ||
    ipv6In(value, 0x20010000n << 96n, 32) || ipv6In(value, 0x20010002n << 80n, 48) ||
    ipv6In(value, 0x3fffn << 108n, 20) || ipv6In(value, 0x64ff9bn << 80n, 48);
}

export async function assertSafeExternalUrl(raw: string, allowedHosts: ReadonlySet<string> = SEC_ALLOWED_HOSTS, lookupImpl: AddressLookup = lookup as AddressLookup): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("NEWS_SOURCE_URL_INVALID"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !allowedHosts.has(url.hostname.toLowerCase())) throw new Error("NEWS_SOURCE_URL_NOT_ALLOWED");
  const addresses = await lookupImpl(url.hostname, { all: true });
  if (!addresses.length || addresses.some(item => privateAddress(item.address))) throw new Error("NEWS_SOURCE_PRIVATE_ADDRESS");
  return url;
}

export async function fetchSafeExternal(input: string, init?: RequestInit, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const initial = await assertSafeExternalUrl(input);
  const response = await fetchImpl(initial, { ...init, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) throw new Error("NEWS_SOURCE_REDIRECT_INVALID");
    await assertSafeExternalUrl(new URL(location, initial).toString());
    throw new Error("NEWS_SOURCE_REDIRECT_REQUIRES_REVALIDATION");
  }
  return response;
}

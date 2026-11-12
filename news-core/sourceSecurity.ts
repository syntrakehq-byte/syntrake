import { lookup } from "node:dns/promises";

export const SEC_ALLOWED_HOSTS = new Set(["data.sec.gov", "www.sec.gov"]);

function privateAddress(address: string): boolean {
  const value = address.toLowerCase();
  if (value === "::1" || value === "0:0:0:0:0:0:0:1" || value === "0.0.0.0") return true;
  if (value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb")) return true;
  const octets = value.split(".").map(Number);
  if (octets.length !== 4 || octets.some(item => !Number.isInteger(item) || item < 0 || item > 255)) return false;
  return octets[0] === 10 || octets[0] === 127 || (octets[0] === 169 && octets[1] === 254) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168);
}

export async function assertSafeExternalUrl(raw: string, allowedHosts: ReadonlySet<string> = SEC_ALLOWED_HOSTS): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("NEWS_SOURCE_URL_INVALID"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !allowedHosts.has(url.hostname.toLowerCase())) throw new Error("NEWS_SOURCE_URL_NOT_ALLOWED");
  const addresses = await lookup(url.hostname, { all: true });
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

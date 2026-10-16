export function toCleanString(v: unknown, max = 300) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s.slice(0, max);
}

function stripWrappingQuotes(input: string) {
  const trimmed = input.trim();
  return trimmed.replace(/^["']+|["']+$/g, "").trim();
}

export function resolveAppUrl(rawAppUrl?: string, fallbackAbsoluteUrl?: string) {
  const raw = stripWrappingQuotes(rawAppUrl || "");
  try {
    if (raw) {
      const url = new URL(raw);
      return url.toString().replace(/\/$/, "");
    }
  } catch {
    // ignore and try fallback
  }

  const fallback = stripWrappingQuotes(fallbackAbsoluteUrl || "");
  try {
    if (fallback) {
      const url = new URL(fallback);
      return `${url.protocol}//${url.host}`;
    }
  } catch {
    // ignore and final fallback
  }

  return "http://localhost:3000";
}

export function resolvePortalReturnUrl(raw: unknown, rawAppUrl?: string, fallbackAbsoluteUrl?: string) {
  const appUrl = resolveAppUrl(rawAppUrl, fallbackAbsoluteUrl);
  const candidate = toCleanString(raw, 300);
  if (!candidate) return `${appUrl}/start`;

  if (/^https?:\/\//i.test(candidate)) {
    try {
      const target = new URL(candidate);
      const app = new URL(appUrl);
      if (target.origin === app.origin) return target.toString();
    } catch {
      // ignore and fallback
    }
    return `${appUrl}/start`;
  }

  const path = candidate.startsWith("/") ? candidate : `/${candidate}`;
  return `${appUrl}${path}`;
}

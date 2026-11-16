/** Deterministic, loss-minimising normalization for feed/document excerpts. */
export function normalizeNewsTextV1(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => {
      const number = code.toLowerCase().startsWith("x") ? parseInt(code.slice(1), 16) : Number(code);
      return Number.isFinite(number) && number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : "";
    })
    .replace(/&(?:nbsp|#160);/gi, " ")
    .replace(/&(?:amp|#38|#038);/gi, "&")
    .replace(/&(?:quot);/gi, '"')
    .replace(/&(?:apos);/gi, "'")
    .replace(/&(?:lt);/gi, "<")
    .replace(/&(?:gt);/gi, ">")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeNewsTlsCaPem(value: string): string {
  return value.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").trim();
}

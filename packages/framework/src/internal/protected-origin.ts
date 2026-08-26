const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function protectedOrigin(value: string, allowHttpLoopback = false): URL | undefined {
  let origin: URL;
  try { origin = new URL(value); } catch { return undefined; }
  const allowed = origin.protocol === "https:" || (allowHttpLoopback
    && origin.protocol === "http:" && loopbackHosts.has(origin.hostname));
  return allowed && origin.origin === value && !origin.username && !origin.password
    ? origin
    : undefined;
}

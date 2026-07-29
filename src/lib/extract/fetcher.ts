import { lookup } from "dns/promises";
import { isIP } from "net";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/131.0.0.0 Safari/537.36";

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;

/** Users paste arbitrary URLs, so refuse anything pointing at our own network. */
function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v6 = ip.toLowerCase();
    if (v6 === "::1" || v6 === "::") return true;
    if (v6.startsWith("fc") || v6.startsWith("fd")) return true; // unique-local
    if (v6.startsWith("fe80")) return true; // link-local
    // IPv4-mapped, e.g. ::ffff:127.0.0.1
    const mapped = v6.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }

  const [a, b] = ip.split(".").map(Number);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

export async function assertPublicUrl(url: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("That doesn't look like a valid URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https URLs can be tracked.");
  }

  const host = parsed.hostname;
  const addresses = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true }).catch(() => {
        throw new Error(`Couldn't resolve ${host}.`);
      });

  if (!addresses.length) throw new Error(`Couldn't resolve ${host}.`);
  if (addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error("That URL points at a private address.");
  }

  return parsed;
}

/**
 * Fetches a page as text with browser-ish headers, a timeout and a size cap.
 *
 * Redirects are followed by hand rather than by undici, because every hop has
 * to be re-checked: a public URL is free to 302 to 169.254.169.254, and
 * `redirect: "follow"` would take us there without another look.
 */
export async function fetchText(url: string, init: RequestInit = {}): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let current = url;

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublicUrl(current);

      const response = await fetch(current, {
        ...init,
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-SG,en;q=0.9",
          // Don't set accept-encoding: undici only auto-decompresses responses
          // when it owns that header, and we'd be left parsing gzip bytes.
          "cache-control": "no-cache",
          ...(init.headers as Record<string, string> | undefined),
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error(`HTTP ${response.status} with no Location header`);
        // Discard the body so the socket can be reused.
        await response.arrayBuffer().catch(() => undefined);
        current = new URL(location, current).toString();
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > MAX_BYTES) throw new Error("Page is too large to parse.");

      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > MAX_BYTES) throw new Error("Page is too large to parse.");

      return new TextDecoder("utf-8").decode(buffer);
    }

    throw new Error(`Too many redirects (more than ${MAX_REDIRECTS}).`);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("The site took too long to respond.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

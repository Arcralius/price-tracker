import { adaptersFor } from "./adapters";
import { fetchText } from "./fetcher";
import { extractGeneric } from "./generic";
import { Extraction } from "./types";

export { fetchText, assertPublicUrl } from "./fetcher";
export type { Extraction } from "./types";
export { parsePrice } from "./types";

/**
 * Resolves a product URL to a price. Site adapters get first refusal; the
 * structured-data extractor is the fallback that makes unknown sites work.
 */
export async function extractFromUrl(url: string): Promise<Extraction> {
  const matched = adaptersFor(url);
  const failures: string[] = [];

  for (const adapter of matched) {
    if (!adapter.fetchDirect) continue;
    try {
      const result = await adapter.fetchDirect(url, fetchText);
      if (result) return result;
      failures.push(`${adapter.name}: no price in API response`);
    } catch (error) {
      failures.push(`${adapter.name}: ${message(error)}`);
    }
  }

  let html: string;
  try {
    html = await fetchText(url);
  } catch (error) {
    const detail = failures.length ? ` (also tried ${failures.join("; ")})` : "";
    throw new Error(`${message(error)}${detail}`);
  }

  for (const adapter of matched) {
    if (!adapter.fromHtml) continue;
    try {
      const result = adapter.fromHtml(html, url);
      if (result) return result;
      failures.push(`${adapter.name}: no price in HTML`);
    } catch (error) {
      failures.push(`${adapter.name}: ${message(error)}`);
    }
  }

  const generic = extractGeneric(html, url);
  if (generic) return generic;

  const detail = failures.length ? ` Tried: ${failures.join("; ")}.` : "";
  throw new Error(
    `Couldn't find a price on that page. The site may render prices in JavaScript or block automated visits.${detail}`
  );
}

/** Strips tracking params so the same product isn't tracked twice. */
export function canonicalizeUrl(input: string): string {
  const url = new URL(input);
  const junk = [
    /^utm_/i, /^gclid$/i, /^fbclid$/i, /^msclkid$/i, /^ref$/i, /^ref_$/i,
    /^_encoding$/i, /^psc$/i, /^tag$/i, /^linkCode$/i, /^th$/i, /^pd_rd_/i,
    /^pf_rd_/i, /^spm$/i, /^srsltid$/i,
  ];

  for (const key of [...url.searchParams.keys()]) {
    if (junk.some((re) => re.test(key))) url.searchParams.delete(key);
  }

  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  return url.toString();
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

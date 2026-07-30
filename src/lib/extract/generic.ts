import * as cheerio from "cheerio";
import { Extraction, currencyFromUrl, guessCurrency, parsePrice } from "./types";

type Loaded = cheerio.CheerioAPI;

/**
 * Structured-data extractors, tried in descending order of trustworthiness.
 * Most modern storefronts (Shopify, Magento, SFCC, WooCommerce, Uniqlo, Zalora,
 * most airlines' fare pages) emit at least one of these.
 */
export function extractGeneric(html: string, url: string): Extraction | null {
  const $ = cheerio.load(html);
  const found =
    fromJsonLd($, html) ??
    fromMicrodata($) ??
    fromMeta($) ??
    fromNextData(html) ??
    fromVisibleText($) ??
    null;

  if (!found) return null;

  // A strategy that couldn't find a currency beside the price leaves it blank
  // rather than guessing; fill it from the site's own region.
  if (!found.currency) found.currency = currencyFromUrl(url);
  return found;
}

/* ------------------------------- JSON-LD -------------------------------- */

function fromJsonLd($: Loaded, html: string): Extraction | null {
  const blocks: unknown[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw.trim()) return;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // Some sites emit trailing commas or embedded newlines. Try a light repair.
      try {
        blocks.push(JSON.parse(raw.replace(/,\s*([}\]])/g, "$1")));
      } catch {
        /* give up on this block */
      }
    }
  });

  for (const node of flatten(blocks)) {
    const product = asProduct(node);
    if (product) return product;
  }
  return null;
}

/** Walks @graph / arrays / nested objects so we see every node once. */
function* flatten(input: unknown, depth = 0): Generator<Record<string, unknown>> {
  if (depth > 6 || input === null || typeof input !== "object") return;

  if (Array.isArray(input)) {
    for (const item of input) yield* flatten(item, depth + 1);
    return;
  }

  const obj = input as Record<string, unknown>;
  yield obj;

  for (const key of ["@graph", "itemListElement", "mainEntity", "hasVariant", "offers"]) {
    if (key in obj) yield* flatten(obj[key], depth + 1);
  }
}

function typeOf(node: Record<string, unknown>): string[] {
  const t = node["@type"];
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
  return [];
}

function asProduct(node: Record<string, unknown>): Extraction | null {
  const types = typeOf(node).map((t) => t.toLowerCase());
  const isProduct = types.some((t) =>
    ["product", "productmodel", "individualproduct", "vehicle", "flightreservation", "trip", "flight"].includes(t)
  );
  if (!isProduct) return null;

  const offer = pickOffer(node["offers"]);
  const priceRaw =
    offer?.["price"] ??
    offer?.["lowPrice"] ??
    offer?.["highPrice"] ??
    (offer?.["priceSpecification"] as Record<string, unknown> | undefined)?.["price"] ??
    node["price"];

  const price = parsePrice(priceRaw as string | number);
  if (price === null) return null;

  const currency =
    str(offer?.["priceCurrency"]) ??
    str((offer?.["priceSpecification"] as Record<string, unknown> | undefined)?.["priceCurrency"]) ??
    str(node["priceCurrency"]) ??
    "SGD";

  const availability = (str(offer?.["availability"]) ?? "").toLowerCase();

  return {
    title: str(node["name"]) ?? "Untitled product",
    price,
    listPrice: parsePrice(offer?.["listPrice"] as string) ?? undefined,
    currency: currency.toUpperCase(),
    imageUrl: firstImage(node["image"]),
    // Absent availability is treated as in stock — most pages omit it when stocked.
    inStock: availability === "" || !/outofstock|soldout|discontinued/.test(availability),
    source: "json-ld",
  };
}

function pickOffer(offers: unknown): Record<string, unknown> | null {
  if (!offers || typeof offers !== "object") return null;

  if (Array.isArray(offers)) {
    // Prefer the cheapest in-stock offer; that's the price a shopper would pay.
    const parsed = offers
      .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
      .map((o) => ({ o, p: parsePrice(o["price"] as string) }))
      .filter((x) => x.p !== null)
      .sort((a, b) => (a.p as number) - (b.p as number));
    return parsed[0]?.o ?? null;
  }

  const obj = offers as Record<string, unknown>;
  // AggregateOffer wraps the real offers.
  if (obj["offers"]) return pickOffer(obj["offers"]) ?? obj;
  return obj;
}

/* ------------------------------ Microdata ------------------------------- */

function fromMicrodata($: Loaded): Extraction | null {
  const priceEl = $('[itemprop="price"]').first();
  if (!priceEl.length) return null;

  const price = parsePrice(priceEl.attr("content") ?? priceEl.text());
  if (price === null) return null;

  const currencyEl = $('[itemprop="priceCurrency"]').first();
  const availability = ($('[itemprop="availability"]').first().attr("href") ?? "").toLowerCase();

  return {
    title: text($, '[itemprop="name"]') ?? text($, "h1") ?? $("title").text().trim() ?? "Untitled product",
    price,
    currency: (currencyEl.attr("content") ?? currencyEl.text() ?? "SGD").trim().toUpperCase() || "SGD",
    imageUrl: $('[itemprop="image"]').first().attr("src") ?? undefined,
    inStock: availability === "" || !/outofstock|soldout/.test(availability),
    source: "microdata",
  };
}

/* -------------------------------- <meta> -------------------------------- */

const PRICE_META = [
  'meta[property="product:price:amount"]',
  'meta[property="og:price:amount"]',
  'meta[name="twitter:data1"]',
  'meta[itemprop="price"]',
  'meta[property="product:sale_price:amount"]',
];

function fromMeta($: Loaded): Extraction | null {
  for (const selector of PRICE_META) {
    const raw = $(selector).first().attr("content");
    const price = parsePrice(raw);
    if (price === null) continue;

    const currency =
      $('meta[property="product:price:currency"]').attr("content") ??
      $('meta[property="og:price:currency"]').attr("content") ??
      guessCurrency(raw);

    return {
      title:
        $('meta[property="og:title"]').attr("content") ??
        text($, "h1") ??
        $("title").text().trim() ??
        "Untitled product",
      price,
      currency: currency.trim().toUpperCase(),
      imageUrl: $('meta[property="og:image"]').attr("content") ?? undefined,
      inStock: true,
      source: "meta",
    };
  }
  return null;
}

/* --------------------------- __NEXT_DATA__ etc. -------------------------- */

/**
 * Many JS storefronts inline their state as JSON. We look for the common
 * price-ish keys rather than trying to understand each site's shape.
 */
function fromNextData(html: string): Extraction | null {
  const blobs = [
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
    /<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
    /window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});?\s*<\/script>/,
    /window\.__PRELOADED_STATE__\s*=\s*({[\s\S]*?});?\s*<\/script>/,
  ];

  for (const re of blobs) {
    const m = html.match(re);
    if (!m) continue;
    let data: unknown;
    try {
      data = JSON.parse(m[1]);
    } catch {
      continue;
    }

    // Strong keys first. Only fall back to the vague ones if nothing names a
    // price outright, so a "discountAmount" or shipping total can't win.
    const found = searchJson(data, STRONG_PRICE_KEYS) ?? searchJson(data, WEAK_PRICE_KEYS);
    if (found) return found;
  }
  return null;
}

const STRONG_PRICE_KEYS =
  /^(price|currentprice|saleprice|finalprice|nowprice|priceincltax|minprice|lowestprice|unitprice)$/i;
const WEAK_PRICE_KEYS = /^(amount|value|totalprice|grandtotal)$/i;
const TITLE_KEYS = /^(name|title|productname|displayname)$/i;

function searchJson(root: unknown, PRICE_KEYS: RegExp): Extraction | null {
  const queue: unknown[] = [root];
  let title: string | undefined;
  let price: number | null = null;
  let currency: string | undefined;
  let steps = 0;

  while (queue.length && steps < 20_000) {
    steps++;
    const node = queue.shift();
    if (!node || typeof node !== "object") continue;

    if (Array.isArray(node)) {
      queue.push(...node);
      continue;
    }

    const obj = node as Record<string, unknown>;

    for (const [key, value] of Object.entries(obj)) {
      if (price === null && PRICE_KEYS.test(key)) {
        const p = parsePrice(value as string | number);
        if (p !== null) {
          price = p;
          // Only trust a currency sitting beside the price. Searching the whole
          // blob picks up unrelated config — a Uniqlo SG page carries a stray
          // "USD" that would otherwise mislabel a page priced in SGD.
          currency = siblingCurrency(obj);
        } else if (value && typeof value === "object") {
          // Shapes like { price: { value: 49.9, currency: "SGD" } }.
          queue.push(value);
        }
      }
      if (!title && TITLE_KEYS.test(key) && typeof value === "string" && value.length > 2) {
        title = value;
      }
      if (value && typeof value === "object") queue.push(value);
    }
  }

  if (price === null) return null;
  return {
    title: title ?? "Untitled product",
    price,
    currency: currency?.toUpperCase() ?? "",
    inStock: true,
    source: "inline-json",
  };
}

/** A 3-letter currency code declared on the same object as the price. */
function siblingCurrency(obj: Record<string, unknown>): string | undefined {
  for (const [key, value] of Object.entries(obj)) {
    if (!/currency/i.test(key)) continue;
    if (typeof value === "string" && /^[A-Za-z]{3}$/.test(value)) return value;
    // { currency: { code: "SGD", symbol: "$" } }
    if (value && typeof value === "object") {
      const code = (value as Record<string, unknown>)["code"];
      if (typeof code === "string" && /^[A-Za-z]{3}$/.test(code)) return code;
    }
  }
  return undefined;
}

/* ---------------------------- Visible-text last -------------------------- */

const PRICE_SELECTORS = [
  ".price", ".product-price", ".product__price", ".price__current",
  "[class*='price-now']", "[class*='current-price']", "[class*='sale-price']",
  "[data-testid*='price']", "[class*='Price']", "#priceblock_ourprice",
];

function fromVisibleText($: Loaded): Extraction | null {
  for (const selector of PRICE_SELECTORS) {
    const el = $(selector).first();
    if (!el.length) continue;
    const raw = el.text().trim();
    const price = parsePrice(raw);
    if (price === null) continue;

    return {
      title:
        $('meta[property="og:title"]').attr("content") ??
        text($, "h1") ??
        $("title").text().trim() ??
        "Untitled product",
      price,
      currency: guessCurrency(raw),
      imageUrl: $('meta[property="og:image"]').attr("content") ?? undefined,
      inStock: true,
      source: `dom:${selector}`,
    };
  }
  return null;
}

/* -------------------------------- helpers -------------------------------- */

function text($: Loaded, selector: string): string | undefined {
  const t = $(selector).first().text().trim();
  return t || undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function firstImage(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return firstImage(v[0]);
  if (v && typeof v === "object") return str((v as Record<string, unknown>)["url"]);
  return undefined;
}

import * as cheerio from "cheerio";
import { Extraction, guessCurrency, parsePrice } from "./types";

/**
 * A site adapter either parses HTML we already fetched, or takes over the fetch
 * entirely (for sites whose price only exists behind a JSON API).
 */
export type Adapter = {
  name: string;
  matches: (host: string, url: string) => boolean;
  fromHtml?: (html: string, url: string) => Extraction | null;
  fetchDirect?: (url: string, get: Fetcher) => Promise<Extraction | null>;
};

export type Fetcher = (url: string, init?: RequestInit) => Promise<string>;

/* -------------------------------- Amazon -------------------------------- */

const amazon: Adapter = {
  name: "amazon",
  matches: (host) => /(^|\.)amazon\.[a-z.]+$/.test(host),
  fromHtml(html) {
    const $ = cheerio.load(html);

    // Amazon renders the payable price in a visually-hidden .a-offscreen span.
    const candidates = [
      "#corePriceDisplay_desktop_feature_div .a-price .a-offscreen",
      "#corePrice_feature_div .a-price .a-offscreen",
      "#apex_desktop .a-price .a-offscreen",
      "#priceblock_ourprice",
      "#priceblock_dealprice",
      ".a-price .a-offscreen",
    ];

    let price: number | null = null;
    let raw = "";
    for (const selector of candidates) {
      raw = $(selector).first().text().trim();
      price = parsePrice(raw);
      if (price !== null) break;
    }
    if (price === null) return null;

    const listRaw = $("span.basisPrice .a-offscreen, #listPrice, .a-text-price .a-offscreen")
      .first()
      .text();

    const title = $("#productTitle").text().trim() || $('meta[name="title"]').attr("content") || "Amazon product";
    const image =
      $("#landingImage").attr("src") ??
      $("#imgBlkFront").attr("src") ??
      $('meta[property="og:image"]').attr("content");

    const availability = $("#availability").text().toLowerCase();

    return {
      title,
      price,
      listPrice: parsePrice(listRaw) ?? undefined,
      currency: guessCurrency(raw, "SGD"),
      imageUrl: image ?? undefined,
      inStock: !/currently unavailable|out of stock/.test(availability),
      source: "adapter:amazon",
    };
  },
};

/* -------------------------------- Uniqlo -------------------------------- */

/**
 * Uniqlo's product pages are client-rendered, but the storefront API they call
 * is public. URL shape: /<region>/en/products/E457263-000
 */
const uniqlo: Adapter = {
  name: "uniqlo",
  matches: (host) => /(^|\.)uniqlo\.com$/.test(host),
  async fetchDirect(url, get) {
    const parsed = new URL(url);
    const segments = parsed.pathname.split("/").filter(Boolean);

    const region = segments[0] ?? "sg";
    const idIndex = segments.indexOf("products");
    if (idIndex === -1 || !segments[idIndex + 1]) return null;

    // Strip any variant suffix: "E457263-000" -> "E457263-000"
    const productId = segments[idIndex + 1].split("?")[0];
    const locale = segments[1] && segments[1].length === 2 ? segments[1] : "en";

    // The storefront sends this header on every API call; without it the API
    // answers "invalid or missing client id".
    const headers = {
      accept: "application/json",
      "x-fr-clientid": `uq.${region}.web-spa`,
    };

    const body = await get(
      `https://www.uniqlo.com/${region}/api/commerce/v5/${locale}/products/${productId}` +
        `/price-groups/00/l2s?withPrices=true&withStocks=true&httpFailure=true`,
      { headers }
    );

    let result: any;
    try {
      result = JSON.parse(body)?.result;
    } catch {
      return null;
    }

    const prices = result?.prices;
    if (!prices || typeof prices !== "object") return null;

    // `prices` is keyed by SKU. Each entry has `base`, plus `promo` when the
    // item is on offer. Take the cheapest SKU — that's what the page shows.
    let best: number | null = null;
    let bestSku: string | null = null;
    let base: number | null = null;
    let currency = "SGD";

    for (const [sku, entry] of Object.entries(prices as Record<string, any>)) {
      const promoValue = parsePrice(entry?.promo?.value);
      const baseValue = parsePrice(entry?.base?.value);
      const effective = promoValue ?? baseValue;
      if (effective === null) continue;

      if (best === null || effective < best) {
        best = effective;
        bestSku = sku;
        base = baseValue;
        // currency is an object: { code: "SGD", symbol: "$" }
        currency = entry?.promo?.currency?.code ?? entry?.base?.currency?.code ?? currency;
      }
    }
    if (best === null) return null;

    const stock = bestSku ? result?.stocks?.[bestSku] : null;

    // The name lives on a separate endpoint; fall back to the product ID.
    let title = productId;
    let imageUrl: string | undefined;
    try {
      const detail = await get(
        `https://www.uniqlo.com/${region}/api/commerce/v5/${locale}/products` +
          `?productIds=${productId}&httpFailure=true`,
        { headers }
      );
      const item = JSON.parse(detail)?.result?.items?.[0];
      if (item?.name) title = item.name;
      imageUrl = item?.images?.main?.[Object.keys(item?.images?.main ?? {})[0]]?.image;
    } catch {
      /* name and image are cosmetic — keep the ID */
    }

    return {
      title,
      price: best,
      listPrice: base !== null && base > best ? base : undefined,
      currency: String(currency).toUpperCase(),
      imageUrl,
      inStock: !stock || stock.statusCode !== "STOCK_OUT",
      source: "adapter:uniqlo-api",
    };
  },
};

/* -------------------------------- Zalora -------------------------------- */

const zalora: Adapter = {
  name: "zalora",
  matches: (host) => /(^|\.)zalora\.[a-z.]+$/.test(host),
  fromHtml(html) {
    const $ = cheerio.load(html);
    const raw = $('[data-testid="pdp-product-price"], .price-value, ._2Vh4r').first().text();
    const price = parsePrice(raw);
    if (price === null) return null;

    return {
      title: $("h1").first().text().trim() || "Zalora product",
      price,
      currency: guessCurrency(raw),
      imageUrl: $('meta[property="og:image"]').attr("content") ?? undefined,
      inStock: true,
      source: "adapter:zalora",
    };
  },
};

/* ------------------------------ Shopify sites ---------------------------- */

/**
 * Any Shopify storefront exposes <product-url>.json. Covers a long tail of
 * small SG retailers without needing a per-shop adapter.
 */
const shopify: Adapter = {
  name: "shopify",
  matches: (_host, url) => /\/products\/[^/?#]+/.test(new URL(url).pathname),
  async fetchDirect(url, get) {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, "");
    const body = await get(`${parsed.origin}${path}.json`, {
      headers: { accept: "application/json" },
    });

    let product: any;
    try {
      product = JSON.parse(body)?.product;
    } catch {
      return null;
    }
    if (!product?.variants?.length) return null;

    let best: number | null = null;
    let compareAt: number | null = null;
    for (const variant of product.variants) {
      const p = parsePrice(variant?.price);
      if (p === null) continue;
      if (best === null || p < best) {
        best = p;
        compareAt = parsePrice(variant?.compare_at_price);
      }
    }
    if (best === null) return null;

    return {
      title: product.title ?? "Product",
      price: best,
      listPrice: compareAt !== null && compareAt > best ? compareAt : undefined,
      // The .json endpoint omits currency; the storefront's own markup has it.
      currency: "SGD",
      imageUrl: product.image?.src ?? product.images?.[0]?.src,
      inStock: product.variants.some((v: any) => v?.available !== false),
      source: "adapter:shopify",
    };
  },
};

/**
 * Ordered by specificity — `shopify` is a structural guess, so it goes last and
 * is allowed to fail through to the generic extractor.
 */
export const adapters: Adapter[] = [amazon, uniqlo, zalora, shopify];

export function adaptersFor(url: string): Adapter[] {
  const host = new URL(url).hostname.toLowerCase();
  return adapters.filter((a) => {
    try {
      return a.matches(host, url);
    } catch {
      return false;
    }
  });
}

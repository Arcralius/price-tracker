import { chromium, type Browser } from "playwright-core";
import { assertPublicUrl } from "./fetcher";

/**
 * Renders a page in a real browser and returns the resulting HTML.
 *
 * This is the fallback for sites that build their price in JavaScript and
 * expose no structured data or JSON API — IKEA and most airline fare pages,
 * for instance. It is deliberately opt-in: without BROWSER_WS_ENDPOINT set,
 * nothing here runs and the app behaves exactly as before.
 *
 * The browser lives in its own container (see the `browser` service), so the
 * app image doesn't carry ~1.5GB of Chromium it usually doesn't need.
 */

const DEFAULT_TIMEOUT_MS = 45_000;

export function browserEnabled(): boolean {
  return Boolean(process.env.BROWSER_WS_ENDPOINT?.trim());
}

function timeout(): number {
  const raw = Number(process.env.BROWSER_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 1000 ? raw : DEFAULT_TIMEOUT_MS;
}

/** Assets that never contain a price but cost most of the page's load time. */
const BLOCKED_RESOURCES = new Set(["image", "media", "font"]);

export async function renderPage(url: string): Promise<string> {
  const endpoint = process.env.BROWSER_WS_ENDPOINT?.trim();
  if (!endpoint) throw new Error("BROWSER_WS_ENDPOINT is not set.");

  // Re-check before navigating: the browser sits on the container network and
  // must not be pointed at internal services.
  await assertPublicUrl(url);

  let browser: Browser | undefined;
  try {
    browser = await chromium.connect(endpoint, { timeout: timeout() });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/131.0.0.0 Safari/537.36",
      locale: "en-SG",
      viewport: { width: 1366, height: 900 },
    });

    await context.route("**/*", (route) => {
      if (BLOCKED_RESOURCES.has(route.request().resourceType())) return route.abort();
      return route.continue();
    });

    const page = await context.newPage();

    try {
      // `domcontentloaded` then a settle wait: `networkidle` never fires on
      // pages with analytics beacons or long-polling, which is most retailers.
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeout() });
      await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => undefined);
      await waitForPrice(page);

      return await page.content();
    } finally {
      await context.close().catch(() => undefined);
    }
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

/**
 * Waits for something price-shaped to appear, rather than a blind sleep — the
 * whole point of using a browser is that the number arrives late.
 */
async function waitForPrice(page: import("playwright-core").Page): Promise<void> {
  const appeared = await page
    .waitForFunction(
      () => {
        const text = document.body?.innerText ?? "";
        // A currency symbol or code adjacent to digits.
        return /(?:[$€£¥₹]|S\$|RM|SGD|USD|EUR|GBP)\s?\d[\d.,]*/.test(text);
      },
      undefined,
      { timeout: 15_000 }
    )
    .then(() => true)
    .catch(() => false);

  // Even once it's visible, frameworks often patch the final value in a tick
  // later. A short settle costs little and avoids catching a placeholder.
  if (appeared) await page.waitForTimeout(750);
}

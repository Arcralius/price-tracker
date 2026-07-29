import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { extractFromUrl } from "./extract";
import { computeStats, formatMoney, type Point } from "./stats";
import { escapeHtml, sendMessage, telegramEnabled } from "./telegram";

export type CheckResult = {
  productId: string;
  title: string;
  ok: boolean;
  price?: number;
  error?: string;
  alertsSent: number;
};

export function num(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === "number" ? value : Number(value.toString());
}

export function toPoints(
  rows: { price: Prisma.Decimal; listPrice: Prisma.Decimal | null; recordedAt: Date; inStock: boolean }[]
): Point[] {
  return rows.map((r) => ({
    price: num(r.price)!,
    listPrice: num(r.listPrice),
    recordedAt: r.recordedAt,
    inStock: r.inStock,
  }));
}

export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Scrapes one product, records a price point, and fires any alerts it triggers. */
export async function checkProduct(productId: string): Promise<CheckResult> {
  const midnight = startOfToday();

  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      // The comparison price is the last one from a *previous* day, so that
      // pressing "check now" repeatedly doesn't read as a drop against itself.
      prices: {
        where: { recordedAt: { lt: midnight } },
        orderBy: { recordedAt: "desc" },
        take: 1,
      },
    },
  });
  if (!product) return { productId, title: "(deleted)", ok: false, error: "Product not found", alertsSent: 0 };

  let extracted;
  try {
    extracted = await extractFromUrl(product.url);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await prisma.product.update({
      where: { id: productId },
      data: { lastCheckedAt: new Date(), lastError: detail.slice(0, 500), failCount: { increment: 1 } },
    });
    return { productId, title: product.title, ok: false, error: detail, alertsSent: 0 };
  }

  const previous = product.prices[0] ? num(product.prices[0].price) : null;

  // One point per product per day: a manual re-check overwrites today's rather
  // than stacking, which would put phantom steps in the chart and history.
  const todaysPoint = await prisma.pricePoint.findFirst({
    where: { productId, recordedAt: { gte: midnight } },
    orderBy: { recordedAt: "desc" },
  });

  const pointData = {
    price: new Prisma.Decimal(extracted.price.toFixed(2)),
    listPrice: extracted.listPrice ? new Prisma.Decimal(extracted.listPrice.toFixed(2)) : null,
    inStock: extracted.inStock,
  };

  if (todaysPoint) {
    await prisma.pricePoint.update({ where: { id: todaysPoint.id }, data: pointData });
  } else {
    await prisma.pricePoint.create({ data: { productId, ...pointData } });
  }

  // Clear a stale alert-suppression: if the price has climbed back above what
  // we last announced, the next fall to that same figure is news again.
  await prisma.trackedItem.updateMany({
    where: { productId, lastNotifiedPrice: { lt: new Prisma.Decimal(extracted.price.toFixed(2)) } },
    data: { lastNotifiedPrice: null },
  });

  await prisma.product.update({
    where: { id: productId },
    data: {
      lastCheckedAt: new Date(),
      lastError: null,
      failCount: 0,
      // Adopt a better title/image once we manage to read one.
      title: extracted.title && extracted.title !== "Untitled product" ? extracted.title : product.title,
      imageUrl: extracted.imageUrl ?? product.imageUrl,
      currency: extracted.currency || product.currency,
    },
  });

  const alertsSent = await notifyWatchers(productId, {
    price: extracted.price,
    listPrice: extracted.listPrice ?? null,
    previous,
  });

  return { productId, title: extracted.title, ok: true, price: extracted.price, alertsSent };
}

type PriceChange = { price: number; listPrice: number | null; previous: number | null };

async function notifyWatchers(productId: string, change: PriceChange): Promise<number> {
  if (!telegramEnabled()) return 0;

  const dropped = change.previous !== null && change.price < change.previous;
  const discounted = change.listPrice !== null && change.listPrice > change.price;
  if (!dropped && !discounted) return 0;

  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { prices: { orderBy: { recordedAt: "asc" } } },
  });
  if (!product) return 0;

  const stats = computeStats(toPoints(product.prices));

  const watchers = await prisma.trackedItem.findMany({
    where: { productId },
    include: { user: true },
  });

  let sent = 0;
  for (const item of watchers) {
    const chatId = item.user.telegramChatId;
    if (!chatId) continue;

    const target = num(item.targetPrice);
    if (target !== null && change.price > target) continue;

    // Don't repeat ourselves for a price we already announced.
    if (num(item.lastNotifiedPrice) === change.price) continue;

    // Without a target, only a genuine drop is worth a ping.
    if (target === null && !dropped) continue;

    const name = item.nickname || product.title;
    const lines = [
      `💸 <b>${escapeHtml(name)}</b>`,
      "",
      `Now <b>${formatMoney(change.price, product.currency)}</b>` +
        (change.previous !== null ? ` (was ${formatMoney(change.previous, product.currency)})` : ""),
    ];

    if (stats.isAtHistoricalLow) lines.push("🏆 That's the lowest price since you started tracking it.");
    else if (stats.low !== null) lines.push(`Historical low: ${formatMoney(stats.low, product.currency)}`);

    if (target !== null) lines.push(`Your target: ${formatMoney(target, product.currency)}`);

    lines.push("", product.url);

    if (await sendMessage(chatId, lines.join("\n"))) {
      await prisma.trackedItem.update({
        where: { id: item.id },
        data: { lastNotifiedPrice: new Prisma.Decimal(change.price.toFixed(2)) },
      });
      sent++;
    }
  }

  return sent;
}

/**
 * Checks every product anyone is tracking. Runs serially with a delay so we
 * don't hammer a single retailer, which is the fastest way to get blocked.
 */
export async function checkAllProducts(options: { delayMs?: number } = {}): Promise<CheckResult[]> {
  const delayMs = options.delayMs ?? 3_000;

  const products = await prisma.product.findMany({
    where: { items: { some: {} } },
    select: { id: true },
    orderBy: { lastCheckedAt: { sort: "asc", nulls: "first" } },
  });

  const results: CheckResult[] = [];
  for (const [index, product] of products.entries()) {
    results.push(await checkProduct(product.id));
    if (index < products.length - 1) await sleep(delayMs);
  }
  return results;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { extractFromUrl } from "./extract";
import { type Point } from "./stats";

export type CheckResult = {
  productId: string;
  title: string;
  ok: boolean;
  price?: number;
  error?: string;
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

/**
 * Scrapes one product and records the day's price point.
 *
 * Deliberately does not send anything: delivery is driven by notification
 * slots (see notify.ts), so that a price recorded at 09:00 can still be
 * reported in an 18:00 digest.
 */
export async function checkProduct(productId: string): Promise<CheckResult> {
  const midnight = startOfToday();

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return { productId, title: "(deleted)", ok: false, error: "Product not found" };

  let extracted;
  try {
    extracted = await extractFromUrl(product.url);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await prisma.product.update({
      where: { id: productId },
      data: { lastCheckedAt: new Date(), lastError: detail.slice(0, 500), failCount: { increment: 1 } },
    });
    return { productId, title: product.title, ok: false, error: detail };
  }

  // One point per product per day: a re-check overwrites today's rather than
  // stacking, which would put phantom steps in the chart and history.
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
      title: extracted.title && extracted.title !== "Untitled product" ? extracted.title : product.title,
      imageUrl: extracted.imageUrl ?? product.imageUrl,
      currency: extracted.currency || product.currency,
    },
  });

  return { productId, title: extracted.title, ok: true, price: extracted.price };
}

/** Scrapes the given products serially, with a gap so one site isn't hammered. */
export async function checkProducts(productIds: string[], delayMs = 3_000): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const [index, id] of productIds.entries()) {
    results.push(await checkProduct(id));
    if (index < productIds.length - 1) await sleep(delayMs);
  }
  return results;
}

/** Every product anyone tracks — the daily baseline so history keeps accruing. */
export async function checkAllProducts(options: { delayMs?: number } = {}): Promise<CheckResult[]> {
  const products = await prisma.product.findMany({
    where: { items: { some: {} } },
    select: { id: true },
    orderBy: { lastCheckedAt: { sort: "asc", nulls: "first" } },
  });
  return checkProducts(
    products.map((p) => p.id),
    options.delayMs ?? 3_000
  );
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

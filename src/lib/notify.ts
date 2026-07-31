import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { dueSlot, effectiveSlots } from "./schedule";
import { computeStats, formatMoney } from "./stats";
import { checkProducts, num, toPoints } from "./tracker";
import { escapeHtml, sendMessage, telegramEnabled } from "./telegram";

/** How stale a price may be when a slot fires before we re-scrape it. */
const FRESH_WITHIN_MINUTES = 30;

export type SlotRun = {
  userId: string;
  email: string;
  slot: string;
  itemsConsidered: number;
  productsRefreshed: number;
  alerted: number;
  sent: boolean;
};

/**
 * Runs every notification slot that has come due.
 *
 * For each account whose slot matches `at`, the items on that slot are
 * refreshed if their price is stale, then anything that moved is reported in a
 * single digest — one message per slot rather than one per item.
 */
export async function runDueSlots(at: Date, windowMinutes: number): Promise<SlotRun[]> {
  const users = await prisma.user.findMany({
    include: {
      items: {
        include: {
          product: { include: { prices: { orderBy: { recordedAt: "asc" } } } },
        },
      },
    },
  });

  const runs: SlotRun[] = [];

  for (const user of users) {
    if (user.items.length === 0) continue;

    // Which of this account's items are due right now? Items can carry their
    // own slots, so two items may fire at different times for one user.
    const due = user.items.filter((item) => {
      const slots = effectiveSlots(item.notifyTimes, user.notifyTimes);
      return dueSlot(slots, at, user.timezone, windowMinutes) !== null;
    });
    if (due.length === 0) continue;

    const slot =
      dueSlot(effectiveSlots(due[0].notifyTimes, user.notifyTimes), at, user.timezone, windowMinutes) ??
      "";

    // Refresh anything whose last check predates the freshness window, so the
    // figure we quote is the one on the site now.
    const cutoff = new Date(at.getTime() - FRESH_WITHIN_MINUTES * 60_000);
    const stale = [
      ...new Set(
        due
          .filter((item) => !item.product.lastCheckedAt || item.product.lastCheckedAt < cutoff)
          .map((item) => item.productId)
      ),
    ];

    if (stale.length) await checkProducts(stale);

    const alerts = await collectAlerts(
      due.map((d) => d.id),
      user.telegramChatId
    );

    let sent = false;
    if (alerts.length && user.telegramChatId && telegramEnabled()) {
      sent = await sendMessage(user.telegramChatId, buildDigest(alerts, slot));
      if (sent) {
        await prisma.$transaction(
          alerts.map((a) =>
            prisma.trackedItem.update({
              where: { id: a.itemId },
              data: { lastNotifiedPrice: new Prisma.Decimal(a.price.toFixed(2)) },
            })
          )
        );
      }
    }

    runs.push({
      userId: user.id,
      email: user.email,
      slot,
      itemsConsidered: due.length,
      productsRefreshed: stale.length,
      alerted: alerts.length,
      sent,
    });
  }

  return runs;
}

type Alert = {
  itemId: string;
  name: string;
  url: string;
  currency: string;
  price: number;
  reference: number | null;
  low: number | null;
  atLow: boolean;
  target: number | null;
};

/**
 * Re-reads the items after any refresh and decides which are worth reporting.
 *
 * An item alerts when the price has fallen below whatever we last told this
 * user (or, if we've told them nothing, below the previous recorded price).
 * With a target set, it must also be at or under that target.
 */
async function collectAlerts(itemIds: string[], chatId: string | null): Promise<Alert[]> {
  if (!chatId) return [];

  const items = await prisma.trackedItem.findMany({
    where: { id: { in: itemIds } },
    include: { product: { include: { prices: { orderBy: { recordedAt: "asc" } } } } },
  });

  const alerts: Alert[] = [];

  for (const item of items) {
    const points = toPoints(item.product.prices);
    if (points.length === 0) continue;

    const stats = computeStats(points);
    const price = stats.current;
    if (price === null || !stats.inStock) continue;

    const lastNotified = num(item.lastNotifiedPrice);
    const previous = points.length > 1 ? points[points.length - 2].price : null;
    const reference = lastNotified ?? previous;

    const target = num(item.targetPrice);

    // Never repeat a figure we've already announced.
    if (lastNotified !== null && price >= lastNotified) continue;

    if (target !== null) {
      if (price > target) continue;
    } else {
      if (reference === null || price >= reference) continue;
    }

    alerts.push({
      itemId: item.id,
      name: item.nickname || item.product.title,
      url: item.product.url,
      currency: item.product.currency,
      price,
      reference,
      low: stats.low,
      atLow: stats.isAtHistoricalLow,
      target,
    });
  }

  return alerts;
}

function buildDigest(alerts: Alert[], slot: string): string {
  const header =
    alerts.length === 1
      ? "💸 <b>A price dropped</b>"
      : `💸 <b>${alerts.length} prices dropped</b>`;

  const lines = [`${header}${slot ? `  <i>(${slot} check)</i>` : ""}`, ""];

  for (const a of alerts) {
    lines.push(`<b>${escapeHtml(a.name)}</b>`);

    const was = a.reference !== null ? ` (was ${formatMoney(a.reference, a.currency)})` : "";
    lines.push(`${formatMoney(a.price, a.currency)}${was}`);

    if (a.atLow) lines.push("🏆 lowest since you started tracking it");
    else if (a.low !== null) lines.push(`low so far: ${formatMoney(a.low, a.currency)}`);

    if (a.target !== null) lines.push(`your target: ${formatMoney(a.target, a.currency)}`);

    lines.push(a.url, "");
  }

  return lines.join("\n").trim();
}

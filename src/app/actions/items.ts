"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { canonicalizeUrl, extractFromUrl } from "@/lib/extract";
import { getUser } from "@/lib/session";
import { checkProduct } from "@/lib/tracker";
import { newLinkCode } from "@/lib/session";
import { pollTelegramLinks, sendMessage } from "@/lib/telegram";

export type ActionState = { error?: string; message?: string };

export async function addItem(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await getUser();
  if (!user) return { error: "You're signed out. Refresh and sign in again." };

  const rawUrl = String(form.get("url") ?? "").trim();
  const nickname = String(form.get("nickname") ?? "").trim();
  const targetRaw = String(form.get("targetPrice") ?? "").trim();

  if (!rawUrl) return { error: "Paste a product URL first." };

  // Each tracked item is a scrape a day forever, so cap what one account can
  // queue up. MAX_ITEMS_PER_USER=0 disables the limit.
  const cap = Number(process.env.MAX_ITEMS_PER_USER ?? 100);
  if (cap > 0) {
    const tracked = await prisma.trackedItem.count({ where: { userId: user.id } });
    if (tracked >= cap) {
      return { error: `You're tracking the maximum of ${cap} items. Remove one first.` };
    }
  }

  let url: string;
  try {
    url = canonicalizeUrl(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);
  } catch {
    return { error: "That doesn't look like a valid URL." };
  }

  const targetPrice = targetRaw ? Number(targetRaw) : null;
  if (targetPrice !== null && (!Number.isFinite(targetPrice) || targetPrice <= 0)) {
    return { error: "Target price must be a positive number." };
  }

  // Scrape once up front — if we can't read a price, don't create a dead entry.
  let extracted;
  try {
    extracted = await extractFromUrl(url);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Couldn't read that page." };
  }

  const product = await prisma.product.upsert({
    where: { url },
    create: {
      url,
      site: new URL(url).hostname.replace(/^www\./, ""),
      title: extracted.title,
      imageUrl: extracted.imageUrl,
      currency: extracted.currency,
      lastCheckedAt: new Date(),
    },
    update: {
      title: extracted.title,
      imageUrl: extracted.imageUrl ?? undefined,
      currency: extracted.currency,
      lastCheckedAt: new Date(),
      lastError: null,
      failCount: 0,
    },
  });

  // Seed history only if nothing was recorded today, so re-adding doesn't double up.
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todaysPoint = await prisma.pricePoint.findFirst({
    where: { productId: product.id, recordedAt: { gte: startOfDay } },
  });

  if (!todaysPoint) {
    await prisma.pricePoint.create({
      data: {
        productId: product.id,
        price: new Prisma.Decimal(extracted.price.toFixed(2)),
        listPrice: extracted.listPrice ? new Prisma.Decimal(extracted.listPrice.toFixed(2)) : null,
        inStock: extracted.inStock,
      },
    });
  }

  const alreadyTracked = await prisma.trackedItem.findUnique({
    where: { userId_productId: { userId: user.id, productId: product.id } },
  });
  if (alreadyTracked) return { error: "You're already tracking that product." };

  await prisma.trackedItem.create({
    data: {
      userId: user.id,
      productId: product.id,
      nickname: nickname || null,
      targetPrice: targetPrice !== null ? new Prisma.Decimal(targetPrice.toFixed(2)) : null,
    },
  });

  revalidatePath("/");
  return { message: `Now tracking ${extracted.title}.` };
}

export async function removeItem(form: FormData) {
  const user = await getUser();
  if (!user) redirect("/login");

  const id = String(form.get("itemId") ?? "");
  await prisma.trackedItem.deleteMany({ where: { id, userId: user.id } });

  revalidatePath("/");
  redirect("/");
}

export async function updateItem(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await getUser();
  if (!user) return { error: "You're signed out." };

  const id = String(form.get("itemId") ?? "");
  const nickname = String(form.get("nickname") ?? "").trim();
  const targetRaw = String(form.get("targetPrice") ?? "").trim();

  const targetPrice = targetRaw ? Number(targetRaw) : null;
  if (targetPrice !== null && (!Number.isFinite(targetPrice) || targetPrice <= 0)) {
    return { error: "Target price must be a positive number." };
  }

  const updated = await prisma.trackedItem.updateMany({
    where: { id, userId: user.id },
    data: {
      nickname: nickname || null,
      targetPrice: targetPrice !== null ? new Prisma.Decimal(targetPrice.toFixed(2)) : null,
    },
  });
  if (!updated.count) return { error: "Item not found." };

  revalidatePath(`/product/${id}`);
  return { message: "Saved." };
}

/** Manual "check now" from a product page. */
export async function refreshItem(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await getUser();
  if (!user) return { error: "You're signed out." };

  const itemId = String(form.get("itemId") ?? "");
  const item = await prisma.trackedItem.findFirst({ where: { id: itemId, userId: user.id } });
  if (!item) return { error: "Item not found." };

  const result = await checkProduct(item.productId);
  revalidatePath(`/product/${itemId}`);

  return result.ok
    ? { message: `Checked — current price ${result.price}.` }
    : { error: result.error ?? "Check failed." };
}

/* ------------------------------- Telegram -------------------------------- */

export async function refreshLinkCode(): Promise<void> {
  const user = await getUser();
  if (!user) redirect("/login");

  await prisma.user.update({
    where: { id: user.id },
    data: { linkCode: newLinkCode(), telegramChatId: null },
  });
  revalidatePath("/settings");
}

export async function checkTelegramLink(_prev: ActionState): Promise<ActionState> {
  const user = await getUser();
  if (!user) return { error: "You're signed out." };

  await pollTelegramLinks();
  const fresh = await prisma.user.findUnique({ where: { id: user.id } });
  revalidatePath("/settings");

  return fresh?.telegramChatId
    ? { message: "Telegram linked." }
    : { error: "No link yet — send /start with your code to the bot, then try again." };
}

export async function setChatIdManually(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await getUser();
  if (!user) return { error: "You're signed out." };

  const chatId = String(form.get("chatId") ?? "").trim();
  if (!/^-?\d+$/.test(chatId)) return { error: "A Telegram chat ID is a number, e.g. 123456789." };

  await prisma.user.update({ where: { id: user.id }, data: { telegramChatId: chatId } });
  revalidatePath("/settings");
  return { message: "Saved." };
}

export async function sendTestMessage(_prev: ActionState): Promise<ActionState> {
  const user = await getUser();
  if (!user) return { error: "You're signed out." };
  if (!user.telegramChatId) return { error: "Link Telegram first." };

  const ok = await sendMessage(
    user.telegramChatId,
    "✅ Test message from your price tracker. Alerts are working."
  );
  return ok ? { message: "Sent — check Telegram." } : { error: "Telegram rejected the message." };
}

export async function unlinkTelegram(): Promise<void> {
  const user = await getUser();
  if (!user) redirect("/login");

  await prisma.user.update({ where: { id: user.id }, data: { telegramChatId: null } });
  revalidatePath("/settings");
}

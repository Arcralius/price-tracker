"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { canonicalizeUrl, extractFromUrl } from "@/lib/extract";
import { getUser } from "@/lib/session";
import { checkProduct } from "@/lib/tracker";
import { isValidTimezone, parseSlots } from "@/lib/schedule";
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
  const slotsRaw = String(form.get("notifyTimes") ?? "").trim();

  const targetPrice = targetRaw ? Number(targetRaw) : null;
  if (targetPrice !== null && (!Number.isFinite(targetPrice) || targetPrice <= 0)) {
    return { error: "Target price must be a positive number." };
  }

  // Blank means "inherit the account default".
  const { slots, invalid } = parseSlots(slotsRaw);
  if (invalid.length) {
    return { error: `Not a valid time: ${invalid.join(", ")}. Use 24-hour HH:MM, e.g. 09:00, 18:30.` };
  }

  const updated = await prisma.trackedItem.updateMany({
    where: { id, userId: user.id },
    data: {
      nickname: nickname || null,
      targetPrice: targetPrice !== null ? new Prisma.Decimal(targetPrice.toFixed(2)) : null,
      notifyTimes: slots,
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


/* --------------------------- Notification schedule ------------------------ */

/** Account-wide default delivery slots, used by items with no override. */
export async function updateSchedule(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await getUser();
  if (!user) return { error: "You're signed out." };

  const timezone = String(form.get("timezone") ?? "").trim();
  if (!timezone || !isValidTimezone(timezone)) {
    return { error: "Pick a valid timezone." };
  }

  const { slots, invalid } = parseSlots(String(form.get("notifyTimes") ?? ""));
  if (invalid.length) {
    return { error: `Not a valid time: ${invalid.join(", ")}. Use 24-hour HH:MM, e.g. 09:00, 18:30.` };
  }
  if (slots.length === 0) {
    return { error: "Add at least one time, or you'll never be notified." };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { timezone, notifyTimes: slots },
  });

  revalidatePath("/settings");
  return { message: `Saved — ${slots.length} notification${slots.length === 1 ? "" : "s"} a day at ${slots.join(", ")}.` };
}

/* --------------------------------- Lists ---------------------------------- */

const MAX_LISTS = 30;
const MAX_LIST_NAME = 40;

export async function createList(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await getUser();
  if (!user) return { error: "You're signed out." };

  const name = String(form.get("name") ?? "").trim().slice(0, MAX_LIST_NAME);
  if (!name) return { error: "Give the list a name." };

  const count = await prisma.itemList.count({ where: { userId: user.id } });
  if (count >= MAX_LISTS) return { error: `You already have ${MAX_LISTS} lists.` };

  const existing = await prisma.itemList.findFirst({ where: { userId: user.id, name } });
  if (existing) return { error: `You already have a list called "${name}".` };

  await prisma.itemList.create({ data: { userId: user.id, name } });
  revalidatePath("/");
  revalidatePath("/settings");
  return { message: `Created "${name}".` };
}

export async function renameList(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await getUser();
  if (!user) return { error: "You're signed out." };

  const id = String(form.get("listId") ?? "");
  const name = String(form.get("name") ?? "").trim().slice(0, MAX_LIST_NAME);
  if (!name) return { error: "A list needs a name." };

  const clash = await prisma.itemList.findFirst({
    where: { userId: user.id, name, NOT: { id } },
  });
  if (clash) return { error: `You already have a list called "${name}".` };

  const updated = await prisma.itemList.updateMany({ where: { id, userId: user.id }, data: { name } });
  if (!updated.count) return { error: "List not found." };

  revalidatePath("/");
  revalidatePath("/settings");
  return { message: "Renamed." };
}

/** Deletes the list only — the items in it stay tracked. */
export async function deleteList(form: FormData): Promise<void> {
  const user = await getUser();
  if (!user) redirect("/login");

  const id = String(form.get("listId") ?? "");
  await prisma.itemList.deleteMany({ where: { id, userId: user.id } });

  revalidatePath("/");
  revalidatePath("/settings");
}

/** Replaces an item's list membership with exactly the ids submitted. */
export async function setItemLists(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await getUser();
  if (!user) return { error: "You're signed out." };

  const itemId = String(form.get("itemId") ?? "");
  const item = await prisma.trackedItem.findFirst({ where: { id: itemId, userId: user.id } });
  if (!item) return { error: "Item not found." };

  // Only accept lists this account owns, so a forged id can't attach anything.
  const requested = form.getAll("listIds").map(String).filter(Boolean);
  const owned = await prisma.itemList.findMany({
    where: { userId: user.id, id: { in: requested } },
    select: { id: true },
  });

  await prisma.trackedItem.update({
    where: { id: itemId },
    data: { lists: { set: owned.map((l) => ({ id: l.id })) } },
  });

  revalidatePath("/");
  revalidatePath(`/product/${itemId}`);
  return { message: owned.length ? `In ${owned.length} list${owned.length === 1 ? "" : "s"}.` : "Removed from all lists." };
}

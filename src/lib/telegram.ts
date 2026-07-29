import { prisma } from "./db";

const API = "https://api.telegram.org";

function token(): string | null {
  const t = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return t ? t : null;
}

export function telegramEnabled(): boolean {
  return token() !== null;
}

async function call<T>(method: string, body?: unknown): Promise<T | null> {
  const t = token();
  if (!t) return null;

  try {
    const response = await fetch(`${API}/bot${t}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await response.json()) as { ok: boolean; result?: T; description?: string };
    if (!json.ok) {
      console.error(`[telegram] ${method} failed: ${json.description}`);
      return null;
    }
    return json.result ?? null;
  } catch (error) {
    console.error(`[telegram] ${method} threw:`, error);
    return null;
  }
}

export async function sendMessage(chatId: string, text: string): Promise<boolean> {
  const result = await call("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: false,
  });
  return result !== null;
}

export async function getBotUsername(): Promise<string | null> {
  const me = await call<{ username?: string }>("getMe");
  return me?.username ?? null;
}

/**
 * Consumes pending bot updates and links any "/start <code>" message to the
 * user holding that code. Called by the worker and by the settings page's
 * "check now" button, so linking works without a public webhook URL.
 */
export async function pollTelegramLinks(): Promise<number> {
  if (!telegramEnabled()) return 0;

  const stored = await prisma.appState.findUnique({ where: { key: "telegram_offset" } });
  const offset = stored ? Number(stored.value) : 0;

  const updates = await call<any[]>("getUpdates", {
    offset: offset || undefined,
    timeout: 0,
    allowed_updates: ["message"],
  });
  if (!updates?.length) return 0;

  let linked = 0;
  let highest = offset;

  for (const update of updates) {
    highest = Math.max(highest, Number(update.update_id) + 1);

    const message = update.message;
    const chatId = message?.chat?.id;
    const text: string = message?.text ?? "";
    if (!chatId || !text) continue;

    const match = text.trim().match(/^\/start\s+([a-f0-9]{8})$/i);
    if (!match) {
      if (/^\/start\b/.test(text.trim())) {
        await sendMessage(
          String(chatId),
          "Hi! Open <b>Settings</b> in your price tracker and use the link button there so I know who you are."
        );
      }
      continue;
    }

    const code = match[1].toLowerCase();
    const user = await prisma.user.findUnique({ where: { linkCode: code } });
    if (!user) {
      await sendMessage(String(chatId), "That link code isn't valid. Grab a fresh one from Settings.");
      continue;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { telegramChatId: String(chatId) },
    });
    await sendMessage(
      String(chatId),
      `Linked to <b>${escapeHtml(user.email)}</b>. I'll message you whenever something you track drops in price.`
    );
    linked++;
  }

  await prisma.appState.upsert({
    where: { key: "telegram_offset" },
    create: { key: "telegram_offset", value: String(highest) },
    update: { value: String(highest) },
  });

  return linked;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

import cron from "node-cron";
import { prisma } from "../src/lib/db";
import { checkAllProducts } from "../src/lib/tracker";
import { pollTelegramLinks, telegramEnabled } from "../src/lib/telegram";

const CHECK_CRON = process.env.CHECK_CRON || "0 9 * * *";
const TIMEZONE = process.env.TZ || "Asia/Singapore";

let running = false;

async function runDailyCheck(trigger: string) {
  if (running) {
    console.log(`[worker] ${trigger}: previous run still in progress, skipping.`);
    return;
  }
  running = true;
  const startedAt = Date.now();

  try {
    console.log(`[worker] ${trigger}: starting price check…`);
    const results = await checkAllProducts();

    const ok = results.filter((r) => r.ok).length;
    const alerts = results.reduce((sum, r) => sum + r.alertsSent, 0);
    const seconds = Math.round((Date.now() - startedAt) / 1000);

    console.log(`[worker] done in ${seconds}s — ${ok}/${results.length} scraped, ${alerts} alert(s) sent.`);
    for (const failure of results.filter((r) => !r.ok)) {
      console.warn(`[worker]   FAILED ${failure.title}: ${failure.error}`);
    }
  } catch (error) {
    console.error("[worker] check run threw:", error);
  } finally {
    running = false;
  }
}

async function main() {
  console.log(`[worker] starting. schedule="${CHECK_CRON}" tz=${TIMEZONE}`);

  if (!cron.validate(CHECK_CRON)) {
    console.error(`[worker] CHECK_CRON "${CHECK_CRON}" is not a valid cron expression. Exiting.`);
    process.exit(1);
  }

  cron.schedule(CHECK_CRON, () => void runDailyCheck("scheduled"), { timezone: TIMEZONE });

  if (telegramEnabled()) {
    // Short poll so "/start <code>" links resolve within a minute.
    cron.schedule("* * * * *", async () => {
      try {
        const linked = await pollTelegramLinks();
        if (linked) console.log(`[worker] linked ${linked} Telegram account(s).`);
      } catch (error) {
        console.error("[worker] telegram poll failed:", error);
      }
    });
    console.log("[worker] Telegram alerts enabled.");
  } else {
    console.log("[worker] TELEGRAM_BOT_TOKEN not set — alerts disabled.");
  }

  if (process.env.CHECK_ON_BOOT === "true") {
    await runDailyCheck("boot");
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    console.log(`[worker] ${signal} received, shutting down.`);
    await prisma.$disconnect();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("[worker] fatal:", error);
  process.exit(1);
});

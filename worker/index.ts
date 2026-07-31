import cron from "node-cron";
import { prisma } from "../src/lib/db";
import { runDueSlots } from "../src/lib/notify";
import { pollTelegramLinks, telegramEnabled } from "../src/lib/telegram";
import { checkAllProducts } from "../src/lib/tracker";

/**
 * The tick interval, in minutes. Notification slots are matched against a
 * window of exactly this width, so changing one without the other would let
 * slots fall between ticks and never fire.
 */
const TICK_MINUTES = 5;
const TICK_CRON = `*/${TICK_MINUTES} * * * *`;

/** Baseline sweep, so price history accrues even for accounts with no alerts. */
const BASELINE_CRON = process.env.CHECK_CRON || "0 9 * * *";
const TIMEZONE = process.env.TZ || "Asia/Singapore";

let slotRunning = false;
let baselineRunning = false;

async function runSlots() {
  if (slotRunning) {
    console.log("[worker] slot tick still running, skipping this one.");
    return;
  }
  slotRunning = true;

  try {
    const runs = await runDueSlots(new Date(), TICK_MINUTES);
    for (const run of runs) {
      console.log(
        `[worker] slot ${run.slot} for ${run.email}: ` +
          `${run.itemsConsidered} item(s) due, ${run.productsRefreshed} refreshed, ` +
          `${run.alerted} alert(s)${run.alerted ? (run.sent ? " sent" : " NOT sent") : ""}.`
      );
    }
  } catch (error) {
    console.error("[worker] slot tick failed:", error);
  } finally {
    slotRunning = false;
  }
}

async function runBaseline(trigger: string) {
  if (baselineRunning) {
    console.log(`[worker] ${trigger}: baseline already running, skipping.`);
    return;
  }
  baselineRunning = true;
  const startedAt = Date.now();

  try {
    console.log(`[worker] ${trigger}: baseline price sweep starting…`);
    const results = await checkAllProducts();
    const ok = results.filter((r) => r.ok).length;
    const seconds = Math.round((Date.now() - startedAt) / 1000);

    console.log(`[worker] baseline done in ${seconds}s — ${ok}/${results.length} scraped.`);
    for (const failure of results.filter((r) => !r.ok)) {
      console.warn(`[worker]   FAILED ${failure.title}: ${failure.error}`);
    }
  } catch (error) {
    console.error("[worker] baseline sweep threw:", error);
  } finally {
    baselineRunning = false;
  }
}

async function main() {
  console.log(`[worker] starting. slots every ${TICK_MINUTES}m, baseline "${BASELINE_CRON}", tz=${TIMEZONE}`);

  if (!cron.validate(BASELINE_CRON)) {
    console.error(`[worker] CHECK_CRON "${BASELINE_CRON}" is not a valid cron expression. Exiting.`);
    process.exit(1);
  }

  // Slots are matched in each account's own timezone, so this scheduler just
  // needs to tick reliably; the container timezone doesn't affect delivery.
  cron.schedule(TICK_CRON, () => void runSlots(), { timezone: "UTC" });
  cron.schedule(BASELINE_CRON, () => void runBaseline("scheduled"), { timezone: TIMEZONE });

  if (telegramEnabled()) {
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
    await runBaseline("boot");
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

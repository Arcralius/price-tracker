import { prisma } from "../src/lib/db";
import { checkAllProducts } from "../src/lib/tracker";

/** `npm run check-now` — scrapes everything immediately instead of waiting for cron. */
async function main() {
  const results = await checkAllProducts({ delayMs: 1_000 });

  for (const result of results) {
    if (result.ok) console.log(`  ok    ${result.price}\t${result.title}`);
    else console.log(`  FAIL  \t${result.title}: ${result.error}`);
  }

  const alerts = results.reduce((sum, r) => sum + r.alertsSent, 0);
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} scraped, ${alerts} alert(s) sent.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

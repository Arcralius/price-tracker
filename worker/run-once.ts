import { prisma } from "../src/lib/db";
import { checkAllProducts } from "../src/lib/tracker";

/** `npm run check-now` — scrapes everything immediately, without notifying. */
async function main() {
  const results = await checkAllProducts({ delayMs: 1_000 });

  for (const result of results) {
    if (result.ok) console.log(`  ok    ${result.price}\t${result.title}`);
    else console.log(`  FAIL  \t${result.title}: ${result.error}`);
  }

  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} scraped.`);
  console.log("Alerts are sent by the worker at your notification times, not here.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

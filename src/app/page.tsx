import Link from "next/link";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { AddItemForm } from "@/components/AddItemForm";
import { FilterBar } from "@/components/FilterBar";
import { prisma } from "@/lib/db";
import { getUser } from "@/lib/session";
import { effectiveSlots } from "@/lib/schedule";
import { computeStats, formatMoney, formatDate } from "@/lib/stats";
import { num, toPoints } from "@/lib/tracker";

export const dynamic = "force-dynamic";

type Search = { list?: string; site?: string; sale?: string };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { list, site, sale } = await searchParams;

  const user = await getUser();
  if (!user) redirect("/login");

  const [allItems, lists] = await Promise.all([
    prisma.trackedItem.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        lists: { select: { id: true, name: true } },
        product: { include: { prices: { orderBy: { recordedAt: "asc" } } } },
      },
    }),
    prisma.itemList.findMany({
      where: { userId: user.id },
      orderBy: { name: "asc" },
      include: { _count: { select: { items: true } } },
    }),
  ]);

  const rows = allItems.map((item) => ({
    item,
    stats: computeStats(toPoints(item.product.prices)),
    slots: effectiveSlots(item.notifyTimes, user.notifyTimes),
    custom: item.notifyTimes.length > 0,
  }));

  // Source options come from everything tracked, not the filtered view, so the
  // dropdown doesn't shrink to a single entry once you pick one.
  const siteCounts = new Map<string, number>();
  for (const r of rows) siteCounts.set(r.item.product.site, (siteCounts.get(r.item.product.site) ?? 0) + 1);
  const sites = [...siteCounts.entries()]
    .map(([s, count]) => ({ site: s, count }))
    .sort((a, b) => a.site.localeCompare(b.site));

  const visible = rows.filter(({ item, stats }) => {
    if (list && !item.lists.some((l) => l.id === list)) return false;
    if (site && item.product.site !== site) return false;
    if (sale === "on" && !stats.onSale) return false;
    if (sale === "off" && stats.onSale) return false;
    if (sale === "low" && !(stats.isAtHistoricalLow && stats.points > 1)) return false;
    return true;
  });

  const atLow = visible.filter((r) => r.stats.isAtHistoricalLow && r.stats.points > 1).length;
  const onSale = visible.filter((r) => r.stats.onSale).length;
  const failing = visible.filter((r) => r.item.product.lastError).length;
  const offPeak = visible.reduce((sum, r) => {
    if (r.stats.high === null || r.stats.current === null) return sum;
    return sum + Math.max(0, r.stats.high - r.stats.current);
  }, 0);

  const activeList = lists.find((l) => l.id === list);

  return (
    <Shell
      email={user.email}
      active="dashboard"
      title={activeList ? activeList.name : "Tracked items"}
      subtitle={
        allItems.length === 0
          ? "Nothing tracked yet"
          : `${allItems.length} item${allItems.length === 1 ? "" : "s"} · alerts at ${user.notifyTimes.join(", ")} ${user.timezone}`
      }
    >
      <div className="stat-grid" style={{ marginBottom: 18 }}>
        <Tile icon="▤" tone="brand" k={activeList || site || sale ? "Showing" : "Tracking"} v={String(visible.length)} n="products" />
        <Tile icon="▼" tone="good" k="At their lowest" v={String(atLow)} n="since you started" />
        <Tile icon="%" tone="warn" k="On sale now" v={String(onSale)} n="below usual price" />
        <Tile
          icon={failing ? "!" : "✓"}
          tone={failing ? "bad" : "info"}
          k={failing ? "Failing checks" : "Off their peak"}
          v={failing ? String(failing) : formatMoney(offPeak, visible[0]?.item.product.currency ?? "SGD")}
          n={failing ? "see the item for why" : "summed across shown items"}
        />
      </div>

      {allItems.length > 0 && (
        <FilterBar
          lists={lists.map((l) => ({ id: l.id, name: l.name, count: l._count.items }))}
          sites={sites}
          total={allItems.length}
          showing={visible.length}
        />
      )}

      <AddItemForm />

      <div style={{ height: 18 }} />

      {allItems.length === 0 ? (
        <div className="empty">
          <div className="big">🏷️</div>
          Paste a product URL above — a Uniqlo item, an Amazon listing, a Shopify store, anything
          with a price on it.
        </div>
      ) : visible.length === 0 ? (
        <div className="empty">
          <div className="big">🔍</div>
          No items match these filters.{" "}
          <Link href="/">Clear them</Link> to see all {allItems.length}.
        </div>
      ) : (
        <div className="item-list">
          {visible.map(({ item, stats, slots, custom }) => {
            const currency = item.product.currency;
            const target = num(item.targetPrice);

            return (
              <Link key={item.id} href={`/product/${item.id}`} className="item">
                {item.product.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="thumb" src={item.product.imageUrl} alt="" />
                ) : (
                  <div className="thumb placeholder">🏷️</div>
                )}

                <div className="body">
                  <div className="title">{item.nickname || item.product.title}</div>
                  <div className="meta">
                    {item.product.site}
                    {" · "}
                    {stats.points} point{stats.points === 1 ? "" : "s"}
                    {target !== null && ` · target ${formatMoney(target, currency)}`}
                    {stats.currentAt && ` · checked ${formatDate(stats.currentAt)}`}
                  </div>
                  <div className="row" style={{ gap: 6, marginTop: 7 }}>
                    {stats.isAtHistoricalLow && stats.points > 1 && <span className="pill low">Lowest yet</span>}
                    {stats.onSale && <span className="pill sale">On sale</span>}
                    {!stats.inStock && <span className="pill oos">Out of stock</span>}
                    {item.product.lastError && <span className="pill err">Check failed</span>}
                    <span className="pill slot" title={custom ? "Custom schedule" : "Account default"}>
                      {custom ? "⏱" : "⏲"} {slots.join(", ")}
                    </span>
                    {item.lists.map((l) => (
                      <span key={l.id} className="list-tag">
                        {l.name}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="price">
                  <div className="now">{formatMoney(stats.current, currency)}</div>
                  {stats.changeAmount !== null && stats.changeAmount !== 0 && (
                    <div className={`meta delta ${stats.changeAmount < 0 ? "down" : "up"}`}>
                      {stats.changeAmount < 0 ? "▼" : "▲"} {formatMoney(Math.abs(stats.changeAmount), currency)}
                    </div>
                  )}
                  {stats.low !== null && <div className="meta">low {formatMoney(stats.low, currency)}</div>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </Shell>
  );
}

function Tile({
  icon, tone, k, v, n,
}: {
  icon: string;
  tone: "brand" | "good" | "warn" | "info" | "bad";
  k: string;
  v: string;
  n?: string;
}) {
  return (
    <div className="stat">
      <div className={`stat-ico ${tone}`}>{icon}</div>
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {n && <div className="n">{n}</div>}
    </div>
  );
}

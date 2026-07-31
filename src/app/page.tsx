import Link from "next/link";
import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { AddItemForm } from "@/components/AddItemForm";
import { prisma } from "@/lib/db";
import { getUser } from "@/lib/session";
import { effectiveSlots } from "@/lib/schedule";
import { computeStats, formatMoney, formatDate } from "@/lib/stats";
import { num, toPoints } from "@/lib/tracker";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const items = await prisma.trackedItem.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: { product: { include: { prices: { orderBy: { recordedAt: "asc" } } } } },
  });

  const rows = items.map((item) => {
    const stats = computeStats(toPoints(item.product.prices));
    return {
      item,
      stats,
      slots: effectiveSlots(item.notifyTimes, user.notifyTimes),
      custom: item.notifyTimes.length > 0,
    };
  });

  const atLow = rows.filter((r) => r.stats.isAtHistoricalLow && r.stats.points > 1).length;
  const onSale = rows.filter((r) => r.stats.onSale).length;
  const failing = rows.filter((r) => r.item.product.lastError).length;

  const totalSaving = rows.reduce((sum, r) => {
    if (r.stats.high === null || r.stats.current === null) return sum;
    return sum + Math.max(0, r.stats.high - r.stats.current);
  }, 0);

  return (
    <Shell
      email={user.email}
      active="dashboard"
      title="Tracked items"
      subtitle={
        items.length === 0
          ? "Nothing tracked yet"
          : `${items.length} item${items.length === 1 ? "" : "s"} · alerts at ${user.notifyTimes.join(", ")} ${user.timezone}`
      }
    >
      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <Tile icon="▤" tone="brand" k="Tracking" v={String(items.length)} n="products" />
        <Tile icon="▼" tone="good" k="At their lowest" v={String(atLow)} n="since you started" />
        <Tile icon="%" tone="warn" k="On sale now" v={String(onSale)} n="below usual price" />
        <Tile
          icon={failing ? "!" : "✓"}
          tone={failing ? "bad" : "info"}
          k={failing ? "Failing checks" : "Off their peak"}
          v={failing ? String(failing) : formatMoney(totalSaving, items[0]?.product.currency ?? "SGD")}
          n={failing ? "see the item for why" : "summed across items"}
        />
      </div>

      <AddItemForm />

      <div style={{ height: 20 }} />

      {items.length === 0 ? (
        <div className="empty">
          <div className="big">🏷️</div>
          Paste a product URL above — a Uniqlo item, an Amazon listing, a Shopify store, anything
          with a price on it.
        </div>
      ) : (
        <div className="item-list">
          {rows.map(({ item, stats, slots, custom }) => {
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
  icon,
  tone,
  k,
  v,
  n,
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

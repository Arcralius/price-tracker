import Link from "next/link";
import { redirect } from "next/navigation";
import { Nav } from "@/components/Nav";
import { AddItemForm } from "@/components/AddItemForm";
import { prisma } from "@/lib/db";
import { getUser } from "@/lib/session";
import { computeStats, formatMoney, formatDate } from "@/lib/stats";
import { num, toPoints } from "@/lib/tracker";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const items = await prisma.trackedItem.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      product: {
        include: { prices: { orderBy: { recordedAt: "asc" } } },
      },
    },
  });

  return (
    <div className="shell">
      <Nav email={user.email} />

      <h1>Tracked products</h1>
      <p className="sub">
        {items.length === 0
          ? "Nothing tracked yet."
          : `${items.length} item${items.length === 1 ? "" : "s"}, checked once a day.`}
      </p>

      <AddItemForm />

      <div style={{ height: 24 }} />

      {items.length === 0 ? (
        <div className="empty">
          Paste a product URL above — a Uniqlo item, an Amazon listing, a flight fare page, anything with a
          price on it.
        </div>
      ) : (
        <div className="item-list">
          {items.map((item) => {
            const stats = computeStats(toPoints(item.product.prices));
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
                    {stats.points} price point{stats.points === 1 ? "" : "s"}
                    {target !== null && ` · target ${formatMoney(target, currency)}`}
                    {stats.currentAt && ` · checked ${formatDate(stats.currentAt)}`}
                  </div>
                  <div className="row" style={{ gap: 6, marginTop: 6 }}>
                    {stats.isAtHistoricalLow && stats.points > 1 && <span className="pill low">Lowest yet</span>}
                    {stats.onSale && <span className="pill sale">On sale</span>}
                    {!stats.inStock && <span className="pill oos">Out of stock</span>}
                    {item.product.lastError && <span className="pill err">Check failed</span>}
                  </div>
                </div>

                <div className="price">
                  <div className="now">{formatMoney(stats.current, currency)}</div>
                  {stats.changeAmount !== null && stats.changeAmount !== 0 && (
                    <div className={`meta delta ${stats.changeAmount < 0 ? "down" : "up"}`}>
                      {stats.changeAmount < 0 ? "▼" : "▲"} {formatMoney(Math.abs(stats.changeAmount), currency)}
                    </div>
                  )}
                  {stats.low !== null && (
                    <div className="meta">low {formatMoney(stats.low, currency)}</div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

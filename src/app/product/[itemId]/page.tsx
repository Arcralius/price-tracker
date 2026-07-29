import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Nav } from "@/components/Nav";
import { PriceChart } from "@/components/PriceChart";
import { ItemControls } from "./ItemControls";
import { prisma } from "@/lib/db";
import { getUser } from "@/lib/session";
import { computeStats, formatDate, formatMoney } from "@/lib/stats";
import { num, toPoints } from "@/lib/tracker";

export const dynamic = "force-dynamic";

export default async function ProductPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;

  const user = await getUser();
  if (!user) redirect("/login");

  const item = await prisma.trackedItem.findFirst({
    where: { id: itemId, userId: user.id },
    include: {
      product: { include: { prices: { orderBy: { recordedAt: "asc" } } } },
    },
  });
  if (!item) notFound();

  const product = item.product;
  const currency = product.currency;
  const points = toPoints(product.prices);
  const stats = computeStats(points);
  const target = num(item.targetPrice);

  const chartData = points.map((p) => ({
    t: p.recordedAt.getTime(),
    price: p.price,
    listPrice: p.listPrice,
  }));

  return (
    <div className="shell">
      <Nav email={user.email} />

      <p style={{ marginTop: 0 }}>
        <Link href="/" className="muted">
          ← All tracked products
        </Link>
      </p>

      <div className="row" style={{ alignItems: "flex-start", gap: 18, marginBottom: 6 }}>
        {product.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.imageUrl}
            alt=""
            style={{ width: 88, height: 88, objectFit: "contain", background: "var(--surface-2)", borderRadius: 10 }}
          />
        )}
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1>{item.nickname || product.title}</h1>
          <p className="sub" style={{ marginBottom: 8 }}>
            {item.nickname && <span>{product.title} · </span>}
            <a href={product.url} target="_blank" rel="noreferrer noopener">
              {product.site} ↗
            </a>
          </p>
          <div className="row" style={{ gap: 6 }}>
            {stats.isAtHistoricalLow && stats.points > 1 && <span className="pill low">Lowest yet</span>}
            {stats.onSale && <span className="pill sale">On sale</span>}
            {!stats.inStock && <span className="pill oos">Out of stock</span>}
          </div>
        </div>
      </div>

      {product.lastError && (
        <div className="alert error">
          Last check failed: {product.lastError}
          {product.failCount > 1 && ` (${product.failCount} consecutive failures)`}
        </div>
      )}

      <div className="card">
        <div className="stat-grid">
          <Stat
            k="Current price"
            v={formatMoney(stats.current, currency)}
            n={stats.currentAt ? `as of ${formatDate(stats.currentAt)}` : undefined}
          />
          <Stat
            k="Historical low"
            v={formatMoney(stats.low, currency)}
            n={stats.lowAt ? `on ${formatDate(stats.lowAt)}` : undefined}
          />
          <Stat
            k="Last discount"
            v={stats.lastDiscountAt ? formatDate(stats.lastDiscountAt) : "None yet"}
            n={
              stats.lastDiscountPrice !== null
                ? `${formatMoney(stats.lastDiscountFrom, currency)} → ${formatMoney(stats.lastDiscountPrice, currency)}`
                : "no drop recorded so far"
            }
          />
          <Stat
            k="Highest seen"
            v={formatMoney(stats.high, currency)}
            n={stats.average !== null ? `average ${formatMoney(stats.average, currency)}` : undefined}
          />
          <Stat
            k="Change since last check"
            v={
              stats.changeAmount === null
                ? "—"
                : `${stats.changeAmount > 0 ? "+" : stats.changeAmount < 0 ? "−" : ""}${formatMoney(
                    Math.abs(stats.changeAmount),
                    currency
                  )}`
            }
            n={stats.changePercent !== null ? `${stats.changePercent.toFixed(1)}%` : undefined}
            tone={stats.changeAmount === null || stats.changeAmount === 0 ? undefined : stats.changeAmount < 0 ? "down" : "up"}
          />
          <Stat k="Data points" v={String(stats.points)} n={`since ${formatDate(product.createdAt)}`} />
        </div>
      </div>

      <div className="card">
        <h2>Price over time</h2>
        <PriceChart data={chartData} currency={currency} low={stats.low} target={target} />
      </div>

      <ItemControls
        itemId={item.id}
        nickname={item.nickname ?? ""}
        targetPrice={target}
        currency={currency}
      />

      <div className="card">
        <h2>History</h2>
        {points.length === 0 ? (
          <p className="muted">No price points yet.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ color: "var(--muted)", textAlign: "left", fontSize: 12.5 }}>
                <th style={{ padding: "6px 0" }}>Date</th>
                <th>Price</th>
                <th>Usual price</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p, i, arr) => {
                const prev = arr[i + 1];
                const delta = prev ? Math.round((p.price - prev.price) * 100) / 100 : null;
                return (
                  <tr key={p.recordedAt.toISOString()} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "8px 0" }}>{formatDate(p.recordedAt)}</td>
                    <td className="mono">{formatMoney(p.price, currency)}</td>
                    <td className="mono muted">{p.listPrice ? formatMoney(p.listPrice, currency) : "—"}</td>
                    <td className={`mono ${delta ? (delta < 0 ? "delta down" : "delta up") : "muted"}`}>
                      {delta === null || delta === 0
                        ? "—"
                        : `${delta < 0 ? "−" : "+"}${formatMoney(Math.abs(delta), currency)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Stat({ k, v, n, tone }: { k: string; v: string; n?: string; tone?: "up" | "down" }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className={`v ${tone ? `delta ${tone}` : ""}`}>{v}</div>
      {n && <div className="n">{n}</div>}
    </div>
  );
}

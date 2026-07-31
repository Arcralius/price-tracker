import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { PriceChart } from "@/components/PriceChart";
import { ItemControls } from "./ItemControls";
import { ListPicker } from "@/components/ListPicker";
import { prisma } from "@/lib/db";
import { getUser } from "@/lib/session";
import { describeSlots, effectiveSlots } from "@/lib/schedule";
import { computeStats, formatDate, formatMoney } from "@/lib/stats";
import { num, toPoints } from "@/lib/tracker";

export const dynamic = "force-dynamic";

export default async function ProductPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;

  const user = await getUser();
  if (!user) redirect("/login");

  const [item, lists] = await Promise.all([
    prisma.trackedItem.findFirst({
      where: { id: itemId, userId: user.id },
      include: {
        lists: { select: { id: true } },
        product: { include: { prices: { orderBy: { recordedAt: "asc" } } } },
      },
    }),
    prisma.itemList.findMany({
      where: { userId: user.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  if (!item) notFound();

  const product = item.product;
  const currency = product.currency;
  const points = toPoints(product.prices);
  const stats = computeStats(points);
  const target = num(item.targetPrice);
  const slots = effectiveSlots(item.notifyTimes, user.notifyTimes);

  const chartData = points.map((p) => ({
    t: p.recordedAt.getTime(),
    price: p.price,
    listPrice: p.listPrice,
  }));

  return (
    <Shell
      email={user.email}
      active="dashboard"
      title={item.nickname || product.title}
      subtitle={`${product.site} · ${describeSlots(slots)}${item.notifyTimes.length ? " (custom)" : ""}`}
    >
      <p style={{ marginTop: 0 }}>
        <Link href="/" className="muted">
          ← All tracked items
        </Link>
      </p>

      <div className="card">
        <div className="row" style={{ alignItems: "flex-start", gap: 18 }}>
          {product.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.imageUrl}
              alt=""
              style={{
                width: 84,
                height: 84,
                objectFit: "contain",
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                borderRadius: 12,
              }}
            />
          )}
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontWeight: 650, fontSize: 15 }}>{product.title}</div>
            <p className="sub" style={{ margin: "4px 0 10px" }}>
              <a href={product.url} target="_blank" rel="noreferrer noopener">
                {product.site} ↗
              </a>
            </p>
            <div className="row" style={{ gap: 6 }}>
              {stats.isAtHistoricalLow && stats.points > 1 && <span className="pill low">Lowest yet</span>}
              {stats.onSale && <span className="pill sale">On sale</span>}
              {!stats.inStock && <span className="pill oos">Out of stock</span>}
              <span className="pill slot">⏱ {slots.join(", ")} {user.timezone}</span>
            </div>
          </div>
        </div>
      </div>

      {product.lastError && (
        <div className="alert error" style={{ marginTop: 18 }}>
          Last check failed: {product.lastError}
          {product.failCount > 1 && ` (${product.failCount} consecutive failures)`}
        </div>
      )}

      <div style={{ height: 18 }} />

      <div className="stat-grid">
        <Stat
          icon="＄" tone="brand" k="Current price"
          v={formatMoney(stats.current, currency)}
          n={stats.currentAt ? `as of ${formatDate(stats.currentAt)}` : undefined}
        />
        <Stat
          icon="▼" tone="good" k="Historical low"
          v={formatMoney(stats.low, currency)}
          n={stats.lowAt ? `on ${formatDate(stats.lowAt)}` : undefined}
        />
        <Stat
          icon="%" tone="warn" k="Last discount"
          v={stats.lastDiscountAt ? formatDate(stats.lastDiscountAt) : "None yet"}
          n={
            stats.lastDiscountPrice !== null
              ? `${formatMoney(stats.lastDiscountFrom, currency)} → ${formatMoney(stats.lastDiscountPrice, currency)}`
              : "no drop recorded so far"
          }
        />
        <Stat
          icon="▲" tone="info" k="Highest seen"
          v={formatMoney(stats.high, currency)}
          n={stats.average !== null ? `average ${formatMoney(stats.average, currency)}` : undefined}
        />
        <Stat
          icon="Δ" tone={!stats.changeAmount ? "info" : stats.changeAmount < 0 ? "good" : "bad"}
          k="Since last check"
          v={
            stats.changeAmount === null
              ? "—"
              : `${stats.changeAmount > 0 ? "+" : stats.changeAmount < 0 ? "−" : ""}${formatMoney(
                  Math.abs(stats.changeAmount),
                  currency
                )}`
          }
          n={stats.changePercent !== null ? `${stats.changePercent.toFixed(1)}%` : undefined}
        />
        <Stat icon="▦" tone="brand" k="Data points" v={String(stats.points)} n={`since ${formatDate(product.createdAt)}`} />
      </div>

      <div style={{ height: 18 }} />

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Price over time</h2>
          </div>
        </div>
        <PriceChart data={chartData} currency={currency} low={stats.low} target={target} />
      </div>

      <ListPicker itemId={item.id} lists={lists} selected={item.lists.map((l) => l.id)} />

      <ItemControls
        itemId={item.id}
        nickname={item.nickname ?? ""}
        targetPrice={target}
        currency={currency}
        notifyTimes={item.notifyTimes}
        accountTimes={user.notifyTimes}
        timezone={user.timezone}
      />

      <div className="card">
        <div className="card-head">
          <div>
            <h2>History</h2>
          </div>
        </div>
        {points.length === 0 ? (
          <p className="muted">No price points yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
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
                    <tr key={p.recordedAt.toISOString()}>
                      <td>{formatDate(p.recordedAt)}</td>
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
          </div>
        )}
      </div>
    </Shell>
  );
}

function Stat({
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

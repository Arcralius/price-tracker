"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type ChartPoint = { t: number; price: number; listPrice: number | null };

export function PriceChart({
  data,
  currency,
  low,
  target,
}: {
  data: ChartPoint[];
  currency: string;
  low: number | null;
  target: number | null;
}) {
  if (data.length < 2) {
    return (
      <div className="empty" style={{ padding: 32 }}>
        Only one price recorded so far — the chart appears after the next daily check.
      </div>
    );
  }

  const prices = data.map((d) => d.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  // Pad the axis so a flat line doesn't sit on the floor of the chart.
  const pad = Math.max((max - min) * 0.18, max * 0.03, 1);

  const money = (v: number) =>
    new Intl.NumberFormat("en-SG", { style: "currency", currency, maximumFractionDigits: 0 }).format(v);

  const moneyExact = (v: number) =>
    new Intl.NumberFormat("en-SG", { style: "currency", currency, minimumFractionDigits: 2 }).format(v);

  return (
    <div style={{ width: "100%", height: 280 }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <defs>
            <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#5b8cff" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#5b8cff" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="#262d3d" vertical={false} />

          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(t) => new Date(t).toLocaleDateString("en-SG", { day: "numeric", month: "short" })}
            stroke="#8b95a8"
            tick={{ fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: "#262d3d" }}
            minTickGap={28}
          />

          <YAxis
            domain={[Math.max(0, min - pad), max + pad]}
            tickFormatter={money}
            stroke="#8b95a8"
            tick={{ fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={64}
          />

          <Tooltip
            contentStyle={{
              background: "#151922",
              border: "1px solid #262d3d",
              borderRadius: 10,
              fontSize: 13,
            }}
            labelStyle={{ color: "#8b95a8" }}
            labelFormatter={(t) =>
              new Date(Number(t)).toLocaleDateString("en-SG", {
                weekday: "short",
                day: "numeric",
                month: "short",
                year: "numeric",
              })
            }
            formatter={(value: number) => [moneyExact(value), "Price"]}
          />

          {low !== null && (
            <ReferenceLine
              y={low}
              stroke="#37d399"
              strokeDasharray="4 4"
              label={{ value: "all-time low", position: "insideBottomLeft", fill: "#37d399", fontSize: 11 }}
            />
          )}

          {target !== null && (
            <ReferenceLine
              y={target}
              stroke="#f0b34a"
              strokeDasharray="2 5"
              label={{ value: "your target", position: "insideTopLeft", fill: "#f0b34a", fontSize: 11 }}
            />
          )}

          <Area
            type="stepAfter"
            dataKey="price"
            stroke="#5b8cff"
            strokeWidth={2}
            fill="url(#priceFill)"
            dot={data.length <= 40 ? { r: 2.5, fill: "#5b8cff", strokeWidth: 0 } : false}
            activeDot={{ r: 4.5 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
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

type Palette = {
  grid: string;
  axis: string;
  line: string;
  surface: string;
  border: string;
  text: string;
  good: string;
  warn: string;
};

const FALLBACK: Palette = {
  grid: "#e6eaf2",
  axis: "#94a3b8",
  line: "#5b5bd6",
  surface: "#ffffff",
  border: "#e6eaf2",
  text: "#1c2536",
  good: "#12a67a",
  warn: "#e2900b",
};

/**
 * Recharts takes concrete colours, not CSS variables (var() isn't resolved in
 * SVG presentation attributes), so read the theme's computed values and
 * re-read them whenever the theme changes.
 */
function useChartPalette(): Palette {
  const [palette, setPalette] = useState<Palette>(FALLBACK);

  useEffect(() => {
    const read = () => {
      const s = getComputedStyle(document.documentElement);
      const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
      setPalette({
        grid: v("--border", FALLBACK.grid),
        axis: v("--text-dim", FALLBACK.axis),
        line: v("--brand", FALLBACK.line),
        surface: v("--surface", FALLBACK.surface),
        border: v("--border", FALLBACK.border),
        text: v("--text", FALLBACK.text),
        good: v("--good", FALLBACK.good),
        warn: v("--warn", FALLBACK.warn),
      });
    };

    read();

    // The toggle stamps data-theme on <html>; the OS preference can also change.
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", read);

    return () => {
      observer.disconnect();
      media.removeEventListener("change", read);
    };
  }, []);

  return palette;
}

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
  const c = useChartPalette();

  if (data.length < 2) {
    return (
      <div className="empty" style={{ padding: 32 }}>
        Only one price recorded so far — the chart appears after the next check.
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

  // With low and target close together the two labels collide, so anchor them
  // to opposite ends of their lines.
  const labelsCollide = low !== null && target !== null && Math.abs(low - target) < (max - min) * 0.12;

  return (
    <div style={{ width: "100%", height: 300 }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
          <defs>
            <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c.line} stopOpacity={0.28} />
              <stop offset="100%" stopColor={c.line} stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke={c.grid} vertical={false} />

          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(t) => new Date(t).toLocaleDateString("en-SG", { day: "numeric", month: "short" })}
            stroke={c.axis}
            tick={{ fontSize: 12, fill: c.axis }}
            tickLine={false}
            axisLine={{ stroke: c.grid }}
            minTickGap={28}
          />

          <YAxis
            domain={[Math.max(0, min - pad), max + pad]}
            tickFormatter={money}
            stroke={c.axis}
            tick={{ fontSize: 12, fill: c.axis }}
            tickLine={false}
            axisLine={false}
            width={64}
          />

          <Tooltip
            contentStyle={{
              background: c.surface,
              border: `1px solid ${c.border}`,
              borderRadius: 10,
              fontSize: 13,
              color: c.text,
              boxShadow: "0 8px 24px -8px rgba(0,0,0,0.25)",
            }}
            labelStyle={{ color: c.axis }}
            itemStyle={{ color: c.text }}
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
              stroke={c.good}
              strokeDasharray="4 4"
              label={{ value: "all-time low", position: "insideBottomLeft", fill: c.good, fontSize: 11 }}
            />
          )}

          {target !== null && (
            <ReferenceLine
              y={target}
              stroke={c.warn}
              strokeDasharray="2 5"
              label={{
                value: "your target",
                position: labelsCollide ? "insideBottomRight" : "insideTopLeft",
                fill: c.warn,
                fontSize: 11,
              }}
            />
          )}

          <Area
            type="stepAfter"
            dataKey="price"
            stroke={c.line}
            strokeWidth={2}
            fill="url(#priceFill)"
            dot={data.length <= 40 ? { r: 2.5, fill: c.line, strokeWidth: 0 } : false}
            activeDot={{ r: 4.5 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

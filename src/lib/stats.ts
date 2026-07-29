export type Point = { price: number; listPrice: number | null; recordedAt: Date; inStock: boolean };

export type Stats = {
  current: number | null;
  currentAt: Date | null;
  inStock: boolean;
  /** Lowest price ever recorded, and when. */
  low: number | null;
  lowAt: Date | null;
  high: number | null;
  average: number | null;
  /** Most recent point where the price dropped below the previous point. */
  lastDiscountAt: Date | null;
  lastDiscountPrice: number | null;
  /** Price immediately before that drop, so the UI can show "was X". */
  lastDiscountFrom: number | null;
  /** Change vs the previous recorded price. */
  changeAmount: number | null;
  changePercent: number | null;
  isAtHistoricalLow: boolean;
  /** True when the current price is under the retailer's own list price. */
  onSale: boolean;
  points: number;
};

export function computeStats(history: Point[]): Stats {
  const points = [...history].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());

  const empty: Stats = {
    current: null, currentAt: null, inStock: true,
    low: null, lowAt: null, high: null, average: null,
    lastDiscountAt: null, lastDiscountPrice: null, lastDiscountFrom: null,
    changeAmount: null, changePercent: null,
    isAtHistoricalLow: false, onSale: false, points: 0,
  };
  if (!points.length) return empty;

  const latest = points[points.length - 1];
  const previous = points.length > 1 ? points[points.length - 2] : null;

  let low = points[0];
  let high = points[0];
  let sum = 0;
  for (const p of points) {
    if (p.price < low.price) low = p;
    if (p.price > high.price) high = p;
    sum += p.price;
  }

  // Walk backwards for the most recent drop.
  let lastDiscountAt: Date | null = null;
  let lastDiscountPrice: number | null = null;
  let lastDiscountFrom: number | null = null;
  for (let i = points.length - 1; i > 0; i--) {
    if (points[i].price < points[i - 1].price) {
      lastDiscountAt = points[i].recordedAt;
      lastDiscountPrice = points[i].price;
      lastDiscountFrom = points[i - 1].price;
      break;
    }
  }

  const changeAmount = previous ? round(latest.price - previous.price) : null;
  const changePercent =
    previous && previous.price > 0 ? round(((latest.price - previous.price) / previous.price) * 100) : null;

  return {
    current: latest.price,
    currentAt: latest.recordedAt,
    inStock: latest.inStock,
    low: low.price,
    lowAt: low.recordedAt,
    high: high.price,
    average: round(sum / points.length),
    lastDiscountAt,
    lastDiscountPrice,
    lastDiscountFrom,
    changeAmount,
    changePercent,
    isAtHistoricalLow: latest.price <= low.price,
    onSale: latest.listPrice !== null && latest.listPrice > latest.price,
    points: points.length,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatMoney(amount: number | null | undefined, currency = "SGD"): string {
  if (amount === null || amount === undefined) return "—";
  try {
    return new Intl.NumberFormat("en-SG", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" });
}

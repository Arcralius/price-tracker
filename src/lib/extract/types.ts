export type Extraction = {
  title: string;
  price: number;
  /** Struck-through / "usual" price when the page exposes one. */
  listPrice?: number;
  currency: string;
  imageUrl?: string;
  inStock: boolean;
  /** Which strategy produced this, for debugging. */
  source: string;
};

export type Adapter = {
  name: string;
  /** Return true if this adapter handles the given hostname. */
  matches: (host: string) => boolean;
  extract: (html: string, url: string) => Extraction | null;
};

/**
 * Parses "S$49.90", "1,299.00", "SGD 89", "$1.234,56" into a number.
 * Returns null when the string has no plausible price in it.
 */
export function parsePrice(raw: string | number | undefined | null): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : null;

  const text = String(raw).trim();
  if (!text) return null;

  // Grab the first number-looking run, allowing thousands separators.
  const match = text.match(/\d[\d.,\s]*\d|\d/);
  if (!match) return null;

  let n = match[0].replace(/\s/g, "");

  const lastComma = n.lastIndexOf(",");
  const lastDot = n.lastIndexOf(".");

  if (lastComma > -1 && lastDot > -1) {
    // Whichever separator comes last is the decimal point.
    if (lastComma > lastDot) n = n.replace(/\./g, "").replace(",", ".");
    else n = n.replace(/,/g, "");
  } else if (lastComma > -1) {
    // "1,299" is thousands; "49,90" is a decimal comma.
    const after = n.length - lastComma - 1;
    n = after === 2 ? n.replace(",", ".") : n.replace(/,/g, "");
  } else {
    // Only dots. "49.90" is a decimal; "1.299" and "1.299.00" are European
    // thousands separators — three trailing digits is the giveaway, since
    // prices are never quoted to three decimal places.
    const dots = n.split(".").length - 1;
    const after = n.length - lastDot - 1;
    if (dots > 1) {
      n = after === 3 ? n.replace(/\./g, "") : n.replace(/\.(?=.*\.)/g, "");
    } else if (dots === 1 && after === 3) {
      n = n.replace(".", "");
    }
  }

  const value = Number.parseFloat(n);
  if (!Number.isFinite(value) || value <= 0) return null;
  // Sanity ceiling — catches product IDs and timestamps scraped by mistake.
  if (value > 5_000_000) return null;
  return Math.round(value * 100) / 100;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  "S$": "SGD",
  "US$": "USD",
  "A$": "AUD",
  "RM": "MYR",
  "£": "GBP",
  "€": "EUR",
  "¥": "JPY",
  "₹": "INR",
  "฿": "THB",
  "₱": "PHP",
  "Rp": "IDR",
  "₩": "KRW",
};

export function guessCurrency(text: string | undefined, fallback = "SGD"): string {
  if (!text) return fallback;

  const iso = text.match(/\b(SGD|USD|MYR|EUR|GBP|JPY|AUD|HKD|CNY|THB|IDR|INR|PHP|KRW|TWD|VND|NZD|CAD)\b/i);
  if (iso) return iso[1].toUpperCase();

  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (text.includes(symbol)) return code;
  }
  // A bare "$" is ambiguous; on .sg sites it's overwhelmingly SGD.
  if (text.includes("$")) return fallback;
  return fallback;
}

/**
 * Notification slots.
 *
 * A slot is a time of day, "HH:mm", interpreted in the account's timezone.
 * Prices are refreshed just before a slot fires, and one digest per slot
 * reports everything that moved — so "how many times a day" is simply how
 * many slots you list.
 *
 * Pure functions, no database or clock of their own, so the matching rules can
 * be tested directly.
 */

export const DEFAULT_SLOT = "09:00";
export const MAX_SLOTS = 12;

/** Normalises "9:5", "09:05", " 9:05 " to "09:05"; returns null if unusable. */
export function normalizeSlot(raw: string): string | null {
  const match = raw.trim().match(/^(\d{1,2})\s*:\s*(\d{2})$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Parses a user-entered list ("09:00, 18:30") into sorted, unique slots.
 * Returns the offending entry so the UI can say which one was wrong.
 */
export function parseSlots(input: string): { slots: string[]; invalid: string[] } {
  const parts = input
    .split(/[,\n]/)
    .map((p) => p.trim())
    .filter(Boolean);

  const slots: string[] = [];
  const invalid: string[] = [];

  for (const part of parts) {
    const slot = normalizeSlot(part);
    if (!slot) invalid.push(part);
    else if (!slots.includes(slot)) slots.push(slot);
  }

  slots.sort();
  return { slots: slots.slice(0, MAX_SLOTS), invalid };
}

/** An item's own slots if it has any, otherwise the account default. */
export function effectiveSlots(itemSlots: string[], userSlots: string[]): string[] {
  if (itemSlots.length > 0) return itemSlots;
  if (userSlots.length > 0) return userSlots;
  return [DEFAULT_SLOT];
}

/** Wall-clock "HH:mm" in an IANA timezone. Falls back to UTC if it's invalid. */
export function localTime(at: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(at);
  }
}

export function isValidTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The slot that has just come due, if any.
 *
 * The worker ticks on a fixed interval; a slot fires on the tick whose window
 * contains it. `windowMinutes` must match the tick interval, or slots falling
 * between ticks would be skipped entirely.
 */
export function dueSlot(
  slots: string[],
  at: Date,
  timeZone: string,
  windowMinutes: number
): string | null {
  const nowMinutes = toMinutes(localTime(at, timeZone));
  if (nowMinutes === null) return null;

  for (const slot of slots) {
    const slotMinutes = toMinutes(slot);
    if (slotMinutes === null) continue;

    // Distance forward from the slot to now, wrapping at midnight, so a
    // 23:58 slot still fires on a 00:00 tick.
    const elapsed = (nowMinutes - slotMinutes + 1440) % 1440;
    if (elapsed < windowMinutes) return slot;
  }
  return null;
}

function toMinutes(hhmm: string): number | null {
  const normalized = normalizeSlot(hhmm);
  if (!normalized) return null;
  const [h, m] = normalized.split(":").map(Number);
  return h * 60 + m;
}

/** Human summary for the UI: "09:00 and 18:00", "3× daily: 08:00, 13:00, 20:00". */
export function describeSlots(slots: string[]): string {
  if (slots.length === 0) return "never";
  if (slots.length === 1) return `once daily at ${slots[0]}`;
  if (slots.length === 2) return `twice daily at ${slots[0]} and ${slots[1]}`;
  return `${slots.length}× daily: ${slots.join(", ")}`;
}

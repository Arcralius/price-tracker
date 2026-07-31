"use client";

import { useActionState, useState } from "react";
import { updateSchedule, type ActionState } from "@/app/actions/items";
import { SubmitButton } from "@/components/SubmitButton";
import { describeSlots, parseSlots } from "@/lib/schedule";

const COMMON_ZONES = [
  "Asia/Singapore", "Asia/Kuala_Lumpur", "Asia/Jakarta", "Asia/Bangkok", "Asia/Hong_Kong",
  "Asia/Tokyo", "Asia/Seoul", "Asia/Kolkata", "Asia/Dubai",
  "Europe/London", "Europe/Paris", "Europe/Berlin",
  "America/New_York", "America/Chicago", "America/Los_Angeles",
  "Australia/Sydney", "Pacific/Auckland", "UTC",
];

const PRESETS: [string, string][] = [
  ["09:00", "Once, morning"],
  ["09:00, 18:00", "Twice a day"],
  ["08:00, 13:00, 20:00", "Three times"],
  ["00:00, 06:00, 12:00, 18:00", "Every 6 hours"],
];

export function SchedulePanel({
  timezone,
  notifyTimes,
}: {
  timezone: string;
  notifyTimes: string[];
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(updateSchedule, {});
  const [times, setTimes] = useState(notifyTimes.join(", "));

  // Live preview of what the server will make of the input.
  const parsed = parseSlots(times);

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Notification schedule</h2>
          <p>When alerts are delivered, and how many times a day. Applies to every item unless it has its own schedule.</p>
        </div>
      </div>

      {state.error && <div className="alert error">{state.error}</div>}
      {state.message && <div className="alert ok">{state.message}</div>}

      <form action={formAction}>
        <div className="field-row">
          <div className="field-grow">
            <label htmlFor="notifyTimes">Delivery times</label>
            <input
              id="notifyTimes"
              name="notifyTimes"
              type="text"
              value={times}
              onChange={(e) => setTimes(e.target.value)}
              placeholder="09:00, 18:00"
            />
            <div className="hint">
              24-hour times, comma separated. Prices are refreshed just before each one, and you get a
              single message per time covering everything that dropped.
            </div>
          </div>

          <div>
            <label htmlFor="timezone">Timezone</label>
            <select id="timezone" name="timezone" defaultValue={timezone}>
              {[...new Set([timezone, ...COMMON_ZONES])].map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
            <div className="hint">Times above are read in this zone.</div>
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <div className="hint" style={{ marginBottom: 6 }}>Quick presets</div>
          <div className="chips">
            {PRESETS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className="chip"
                style={{ cursor: "pointer" }}
                onClick={() => setTimes(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <hr className="divider" />

        <div className="row">
          <SubmitButton pendingLabel="Saving…">Save schedule</SubmitButton>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {parsed.invalid.length > 0
              ? `Can't read: ${parsed.invalid.join(", ")}`
              : parsed.slots.length === 0
                ? "Add at least one time"
                : `You'll be notified ${describeSlots(parsed.slots)}.`}
          </span>
        </div>
      </form>
    </div>
  );
}

"use client";

import { useActionState, useState } from "react";
import { refreshItem, removeItem, updateItem, type ActionState } from "@/app/actions/items";
import { SubmitButton } from "@/components/SubmitButton";
import { describeSlots, parseSlots } from "@/lib/schedule";

export function ItemControls({
  itemId,
  nickname,
  targetPrice,
  currency,
  notifyTimes,
  accountTimes,
  timezone,
}: {
  itemId: string;
  nickname: string;
  targetPrice: number | null;
  currency: string;
  notifyTimes: string[];
  accountTimes: string[];
  timezone: string;
}) {
  const [saveState, saveAction] = useActionState<ActionState, FormData>(updateItem, {});
  const [checkState, checkAction] = useActionState<ActionState, FormData>(refreshItem, {});
  const [times, setTimes] = useState(notifyTimes.join(", "));

  const parsed = parseSlots(times);
  const usingDefault = times.trim() === "";

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>This item</h2>
          <p>Overrides for just this product.</p>
        </div>
      </div>

      {saveState.error && <div className="alert error">{saveState.error}</div>}
      {saveState.message && <div className="alert ok">{saveState.message}</div>}
      {checkState.error && <div className="alert error">{checkState.error}</div>}
      {checkState.message && <div className="alert ok">{checkState.message}</div>}

      <form action={saveAction}>
        <input type="hidden" name="itemId" value={itemId} />

        <div className="field-row">
          <div className="field-grow">
            <label htmlFor="nickname">Nickname</label>
            <input id="nickname" name="nickname" type="text" defaultValue={nickname} placeholder="Optional" />
          </div>
          <div>
            <label htmlFor="targetPrice">Alert me below ({currency})</label>
            <input
              id="targetPrice"
              name="targetPrice"
              type="number"
              step="0.01"
              min="0"
              defaultValue={targetPrice ?? ""}
              placeholder="Any drop"
            />
            <div className="hint">Blank = tell me about any drop.</div>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <label htmlFor="notifyTimes">Notification times for this item</label>
          <input
            id="notifyTimes"
            name="notifyTimes"
            type="text"
            value={times}
            onChange={(e) => setTimes(e.target.value)}
            placeholder={`Leave blank to use your default (${accountTimes.join(", ")})`}
          />
          <div className="hint">
            {usingDefault ? (
              <>
                Using your account default — {describeSlots(accountTimes)} ({timezone}).
              </>
            ) : parsed.invalid.length > 0 ? (
              <>Can&apos;t read: {parsed.invalid.join(", ")}. Use 24-hour HH:MM.</>
            ) : (
              <>
                Custom for this item — {describeSlots(parsed.slots)} ({timezone}). Clear the field to go
                back to your default.
              </>
            )}
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
        </div>
      </form>

      <hr className="divider" />

      <div className="row">
        <form action={checkAction}>
          <input type="hidden" name="itemId" value={itemId} />
          <SubmitButton className="secondary" pendingLabel="Checking…">
            Check price now
          </SubmitButton>
        </form>

        <form
          action={removeItem}
          onSubmit={(e) => {
            if (!confirm("Stop tracking this product?")) e.preventDefault();
          }}
        >
          <input type="hidden" name="itemId" value={itemId} />
          <SubmitButton className="danger" pendingLabel="Removing…">
            Stop tracking
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}

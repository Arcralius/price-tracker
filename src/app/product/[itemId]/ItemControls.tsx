"use client";

import { useActionState } from "react";
import { refreshItem, removeItem, updateItem, type ActionState } from "@/app/actions/items";
import { SubmitButton } from "@/components/SubmitButton";

export function ItemControls({
  itemId,
  nickname,
  targetPrice,
  currency,
}: {
  itemId: string;
  nickname: string;
  targetPrice: number | null;
  currency: string;
}) {
  const [saveState, saveAction] = useActionState<ActionState, FormData>(updateItem, {});
  const [checkState, checkAction] = useActionState<ActionState, FormData>(refreshItem, {});

  return (
    <div className="card">
      <h2>Settings for this item</h2>

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
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
        </div>
      </form>

      <div className="row" style={{ marginTop: 18, borderTop: "1px solid var(--border)", paddingTop: 18 }}>
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

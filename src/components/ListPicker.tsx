"use client";

import { useActionState } from "react";
import { setItemLists, type ActionState } from "@/app/actions/items";
import { SubmitButton } from "./SubmitButton";

/** Which lists this item belongs to. Submitting replaces the whole set. */
export function ListPicker({
  itemId,
  lists,
  selected,
}: {
  itemId: string;
  lists: { id: string; name: string }[];
  selected: string[];
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(setItemLists, {});

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Lists</h2>
          <p>Group this item so you can filter by it on the dashboard.</p>
        </div>
      </div>

      {state.error && <div className="alert error">{state.error}</div>}
      {state.message && <div className="alert ok">{state.message}</div>}

      {lists.length === 0 ? (
        <p className="muted" style={{ marginTop: 0 }}>
          No lists yet — create one from the filter bar on the dashboard.
        </p>
      ) : (
        <form action={formAction}>
          <input type="hidden" name="itemId" value={itemId} />
          <div className="chips" style={{ gap: 8 }}>
            {lists.map((l) => (
              <label key={l.id} className="check-row">
                <input
                  type="checkbox"
                  name="listIds"
                  value={l.id}
                  defaultChecked={selected.includes(l.id)}
                />
                {l.name}
              </label>
            ))}
          </div>
          <div style={{ marginTop: 14 }}>
            <SubmitButton pendingLabel="Saving…">Save lists</SubmitButton>
          </div>
        </form>
      )}
    </div>
  );
}

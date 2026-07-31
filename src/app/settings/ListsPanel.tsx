"use client";

import { useActionState, useState } from "react";
import { createList, deleteList, renameList, type ActionState } from "@/app/actions/items";
import { SubmitButton } from "@/components/SubmitButton";

export function ListsPanel({ lists }: { lists: { id: string; name: string; count: number }[] }) {
  const [createState, createAction] = useActionState<ActionState, FormData>(createList, {});
  const [renameState, renameAction] = useActionState<ActionState, FormData>(renameList, {});
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Lists</h2>
          <p>Group tracked items however you like. Deleting a list keeps the items.</p>
        </div>
      </div>

      {createState.error && <div className="alert error">{createState.error}</div>}
      {createState.message && <div className="alert ok">{createState.message}</div>}
      {renameState.error && <div className="alert error">{renameState.error}</div>}
      {renameState.message && <div className="alert ok">{renameState.message}</div>}

      {lists.length > 0 && (
        <div className="stack" style={{ gap: 8, marginBottom: 16 }}>
          {lists.map((l) => (
            <div key={l.id} className="row" style={{ justifyContent: "space-between", gap: 10 }}>
              {editing === l.id ? (
                <form action={renameAction} className="row" style={{ gap: 8, flex: 1 }}>
                  <input type="hidden" name="listId" value={l.id} />
                  <input name="name" defaultValue={l.name} maxLength={40} required style={{ maxWidth: 260 }} />
                  <SubmitButton pendingLabel="…">Save</SubmitButton>
                  <button type="button" className="ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <div className="row" style={{ gap: 9 }}>
                    <strong style={{ fontSize: 14 }}>{l.name}</strong>
                    <span className="muted" style={{ fontSize: 12.5 }}>
                      {l.count} item{l.count === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <button type="button" className="ghost" onClick={() => setEditing(l.id)}>
                      Rename
                    </button>
                    <form
                      action={deleteList}
                      onSubmit={(e) => {
                        if (!confirm(`Delete the list "${l.name}"? The items stay tracked.`)) e.preventDefault();
                      }}
                    >
                      <input type="hidden" name="listId" value={l.id} />
                      <SubmitButton className="danger" pendingLabel="…">Delete</SubmitButton>
                    </form>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <form action={createAction} className="row" style={{ gap: 8 }}>
        <input name="name" placeholder="New list name" maxLength={40} required style={{ maxWidth: 260 }} />
        <SubmitButton className="secondary" pendingLabel="Creating…">Add list</SubmitButton>
      </form>
    </div>
  );
}

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useActionState, useState } from "react";
import { createList, type ActionState } from "@/app/actions/items";
import { SubmitButton } from "./SubmitButton";

export type ListOption = { id: string; name: string; count: number };

/**
 * Filters are held in the URL rather than component state, so a filtered view
 * survives a refresh, can be bookmarked, and is what the server renders.
 */
export function FilterBar({
  lists,
  sites,
  total,
  showing,
}: {
  lists: ListOption[];
  sites: { site: string; count: number }[];
  total: number;
  showing: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [state, formAction] = useActionState<ActionState, FormData>(createList, {});

  const activeList = params.get("list") ?? "";
  const activeSite = params.get("site") ?? "";
  const activeSale = params.get("sale") ?? "";

  function apply(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const query = next.toString();
    router.push(query ? `/?${query}` : "/");
  }

  const filtered = Boolean(activeList || activeSite || activeSale);

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="filter-row">
        <div className="filter-group">
          <span className="filter-label">List</span>
          <div className="chips">
            <button
              type="button"
              className={`chip clickable ${activeList === "" ? "on" : ""}`}
              onClick={() => apply("list", "")}
            >
              All <span className="chip-n">{total}</span>
            </button>
            {lists.map((l) => (
              <button
                key={l.id}
                type="button"
                className={`chip clickable ${activeList === l.id ? "on" : ""}`}
                onClick={() => apply("list", l.id)}
              >
                {l.name} <span className="chip-n">{l.count}</span>
              </button>
            ))}
            <button type="button" className="chip clickable dashed" onClick={() => setCreating((v) => !v)}>
              + New list
            </button>
          </div>
        </div>

        <div className="filter-group">
          <span className="filter-label">Source</span>
          <select value={activeSite} onChange={(e) => apply("site", e.target.value)} className="filter-select">
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s.site} value={s.site}>
                {s.site} ({s.count})
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <span className="filter-label">Status</span>
          <select value={activeSale} onChange={(e) => apply("sale", e.target.value)} className="filter-select">
            <option value="">Any status</option>
            <option value="on">On sale</option>
            <option value="off">Not on sale</option>
            <option value="low">At historical low</option>
          </select>
        </div>

        {filtered && (
          <button type="button" className="ghost" onClick={() => router.push("/")}>
            Clear filters
          </button>
        )}
      </div>

      {creating && (
        <form action={formAction} className="row" style={{ marginTop: 14, gap: 8 }}>
          <input
            name="name"
            type="text"
            placeholder="List name, e.g. Christmas gifts"
            maxLength={40}
            required
            style={{ maxWidth: 280 }}
          />
          <SubmitButton pendingLabel="Creating…">Create list</SubmitButton>
          <button type="button" className="ghost" onClick={() => setCreating(false)}>
            Cancel
          </button>
        </form>
      )}

      {state.error && <div className="alert error" style={{ marginTop: 12, marginBottom: 0 }}>{state.error}</div>}
      {state.message && <div className="alert ok" style={{ marginTop: 12, marginBottom: 0 }}>{state.message}</div>}

      {filtered && (
        <p className="muted" style={{ fontSize: 12.5, margin: "12px 0 0" }}>
          Showing {showing} of {total} tracked items.
        </p>
      )}
    </div>
  );
}

"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { addItem, type ActionState } from "@/app/actions/items";
import { SubmitButton } from "./SubmitButton";

export function AddItemForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(addItem, {});
  const form = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (state.message) {
      form.current?.reset();
      router.refresh();
    }
  }, [state.message, router]);

  return (
    <div className="card">
      <h2>Track something new</h2>

      {state.error && <div className="alert error">{state.error}</div>}
      {state.message && <div className="alert ok">{state.message}</div>}

      <form action={formAction} ref={form}>
        <div className="field-row">
          <div className="field-grow">
            <label htmlFor="url">Product URL</label>
            <input
              id="url"
              name="url"
              type="text"
              required
              placeholder="https://www.uniqlo.com/sg/en/products/E123456-000"
            />
          </div>
          <div>
            <label htmlFor="nickname">Nickname (optional)</label>
            <input id="nickname" name="nickname" type="text" placeholder="Airism tee" />
          </div>
          <div>
            <label htmlFor="targetPrice">Alert below (optional)</label>
            <input id="targetPrice" name="targetPrice" type="number" step="0.01" min="0" placeholder="29.90" />
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <SubmitButton pendingLabel="Fetching price…">Add</SubmitButton>
          <span className="muted" style={{ fontSize: 12.5, marginLeft: 12 }}>
            We read the price now to confirm the page works.
          </span>
        </div>
      </form>
    </div>
  );
}

"use client";

import { useActionState, useState } from "react";
import { signIn, signUp, type AuthState } from "@/app/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";

export function AuthForm({
  signupsOpen,
  needsInviteCode,
}: {
  signupsOpen: boolean;
  needsInviteCode: boolean;
}) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const action = mode === "in" ? signIn : signUp;
  const [state, formAction] = useActionState<AuthState, FormData>(action, {});

  return (
    <div className="card">
      <form action={formAction} className="stack">
        {state.error && <div className="alert error">{state.error}</div>}

        <div>
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
        </div>

        <div>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === "in" ? "current-password" : "new-password"}
            required
            minLength={8}
            placeholder={mode === "up" ? "At least 8 characters" : "••••••••"}
          />
        </div>

        {mode === "up" && needsInviteCode && (
          <div>
            <label htmlFor="inviteCode">Invite code</label>
            <input id="inviteCode" name="inviteCode" type="text" required placeholder="From the server owner" />
          </div>
        )}

        <SubmitButton pendingLabel={mode === "in" ? "Signing in…" : "Creating…"}>
          {mode === "in" ? "Sign in" : "Create account"}
        </SubmitButton>
      </form>

      {signupsOpen ? (
        <p className="muted" style={{ fontSize: 13, marginTop: 16, marginBottom: 0 }}>
          {mode === "in" ? "No account yet? " : "Already have an account? "}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setMode(mode === "in" ? "up" : "in");
            }}
          >
            {mode === "in" ? "Sign up" : "Sign in"}
          </a>
        </p>
      ) : (
        <p className="muted" style={{ fontSize: 13, marginTop: 16, marginBottom: 0 }}>
          Registration is closed on this server.
        </p>
      )}
    </div>
  );
}

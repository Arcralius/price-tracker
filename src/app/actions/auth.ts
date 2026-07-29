"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { checkRateLimit, clearRateLimit } from "@/lib/rate-limit";
import { createSession, destroySession, newLinkCode } from "@/lib/session";

export type AuthState = { error?: string };

function readCredentials(form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  return { email, password };
}

/**
 * On a server that's reachable from the internet you rarely want open
 * registration. Set SIGNUP_MODE=closed once your own account exists, or
 * SIGNUP_MODE=invite plus SIGNUP_CODE to gate it behind a shared secret.
 * Default stays open so first-run setup isn't a chicken-and-egg problem.
 */
export async function signupsAllowed(): Promise<{ open: boolean; needsCode: boolean }> {
  const mode = (process.env.SIGNUP_MODE ?? "open").toLowerCase();
  if (mode === "closed") return { open: false, needsCode: false };
  if (mode === "invite") return { open: true, needsCode: true };
  return { open: true, needsCode: false };
}

export async function signUp(_prev: AuthState, form: FormData): Promise<AuthState> {
  const { email, password } = readCredentials(form);
  const mode = await signupsAllowed();

  if (!mode.open) return { error: "Registration is closed on this server." };

  if (mode.needsCode) {
    const code = String(form.get("inviteCode") ?? "").trim();
    const expected = process.env.SIGNUP_CODE ?? "";
    if (!expected || code !== expected) return { error: "That invite code isn't valid." };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email address." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };

  const limit = checkRateLimit(`signup:${email}`);
  if (!limit.allowed) return { error: `Too many attempts. Try again in ${limit.retryInSeconds}s.` };

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { error: "An account with that email already exists." };

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, 12),
      linkCode: newLinkCode(),
    },
  });

  await createSession(user.id);
  redirect("/");
}

/**
 * A real bcrypt hash of a value nobody can guess, compared against when the
 * account doesn't exist. Without it, "no such user" returns in ~0ms while a
 * wrong password takes ~300ms, which tells an attacker which emails are real.
 */
const DUMMY_HASH = "$2a$12$Bzk7bagj/eaGEtNOuOFtTOtBrD9HWj8FdM95mMqKxQ7B8HbRBXCXu";

export async function signIn(_prev: AuthState, form: FormData): Promise<AuthState> {
  const { email, password } = readCredentials(form);

  const limit = checkRateLimit(`login:${email}`);
  if (!limit.allowed) {
    return { error: `Too many attempts. Try again in ${limit.retryInSeconds}s.` };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !valid) return { error: "Email or password is incorrect." };

  clearRateLimit(`login:${email}`);
  await createSession(user.id);
  redirect("/");
}

export async function signOut() {
  await destroySession();
  redirect("/login");
}

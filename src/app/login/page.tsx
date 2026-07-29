import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import { signupsAllowed } from "@/app/actions/auth";
import { AuthForm } from "./AuthForm";

export default async function LoginPage() {
  if (await getUser()) redirect("/");

  const signups = await signupsAllowed();

  return (
    <div className="auth-shell">
      <h1>Price Tracker</h1>
      <p className="sub">
        Paste any product URL. We check it once a day and message you on Telegram when it drops.
      </p>
      <AuthForm signupsOpen={signups.open} needsInviteCode={signups.needsCode} />
    </div>
  );
}

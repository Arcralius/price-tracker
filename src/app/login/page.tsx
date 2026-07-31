import { redirect } from "next/navigation";
import { getUser } from "@/lib/session";
import { signupsAllowed } from "@/app/actions/auth";
import { AuthForm } from "./AuthForm";

export default async function LoginPage() {
  if (await getUser()) redirect("/");

  const signups = await signupsAllowed();

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark">₿</span>
          <span className="name">Price Tracker</span>
        </div>
        <p className="sub" style={{ textAlign: "center" }}>
          Paste any product URL. We watch the price and message you on Telegram when it drops.
        </p>
        <AuthForm signupsOpen={signups.open} needsInviteCode={signups.needsCode} />
      </div>
    </div>
  );
}

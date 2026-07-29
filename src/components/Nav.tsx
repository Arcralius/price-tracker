import Link from "next/link";
import { signOut } from "@/app/actions/auth";

export function Nav({ email }: { email: string }) {
  return (
    <nav className="nav">
      <Link href="/" className="brand">
        Price Tracker
      </Link>
      <Link href="/" className="navlink">
        Tracked
      </Link>
      <Link href="/settings" className="navlink">
        Settings
      </Link>
      <span className="spacer" />
      <span className="muted" style={{ fontSize: 13 }}>
        {email}
      </span>
      <form action={signOut}>
        <button className="secondary" style={{ padding: "6px 12px" }}>
          Sign out
        </button>
      </form>
    </nav>
  );
}

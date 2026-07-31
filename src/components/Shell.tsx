import Link from "next/link";
import { signOut } from "@/app/actions/auth";
import { ThemeToggle } from "./ThemeToggle";

type NavKey = "dashboard" | "settings";

export function Shell({
  email,
  active,
  title,
  subtitle,
  actions,
  children,
}: {
  email: string;
  active: NavKey;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const initials = email.slice(0, 2).toUpperCase();

  return (
    <div className="layout">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark">₿</span>
          <span>Price Tracker</span>
        </Link>

        <div className="nav-label">Menu</div>
        <Link href="/" className={`nav-item ${active === "dashboard" ? "active" : ""}`}>
          <span className="ico">▤</span> Tracked items
        </Link>
        <Link href="/settings" className={`nav-item ${active === "settings" ? "active" : ""}`}>
          <span className="ico">⚙</span> Settings
        </Link>

        <div className="sidebar-foot">
          <div className="row" style={{ gap: 10, padding: "0 4px 10px" }}>
            <div className="avatar">{initials}</div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: 150,
                }}
              >
                {email}
              </div>
              <div style={{ fontSize: 11.5 }} className="muted">
                Signed in
              </div>
            </div>
          </div>
          <form action={signOut}>
            <button className="secondary" style={{ width: "100%" }}>
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <h1>{title}</h1>
            {subtitle && <p className="sub" style={{ margin: 0 }}>{subtitle}</p>}
          </div>
          <span className="spacer" />
          {actions}
          <ThemeToggle />
          <div className="avatar" title={email}>
            {initials}
          </div>
        </header>

        <main className="content">{children}</main>
      </div>
    </div>
  );
}

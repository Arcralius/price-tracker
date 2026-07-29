import { redirect } from "next/navigation";
import { Nav } from "@/components/Nav";
import { TelegramPanel } from "./TelegramPanel";
import { getUser } from "@/lib/session";
import { getBotUsername, telegramEnabled } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const enabled = telegramEnabled();
  const botUsername = enabled ? await getBotUsername() : null;

  return (
    <div className="shell">
      <Nav email={user.email} />

      <h1>Settings</h1>
      <p className="sub">Alerts, and how often we check.</p>

      <TelegramPanel
        enabled={enabled}
        botUsername={botUsername}
        linkCode={user.linkCode}
        chatId={user.telegramChatId}
      />

      <div className="card">
        <h2>Checking schedule</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Every tracked product is scraped once a day by the worker process. The time is set with the{" "}
          <code className="inline">CHECK_CRON</code> environment variable (currently{" "}
          <code className="inline">{process.env.CHECK_CRON || "0 9 * * *"}</code> in{" "}
          <code className="inline">{process.env.TZ || "server local time"}</code>). You can also force a check
          for a single item from its page, or run <code className="inline">npm run check-now</code> to scrape
          everything immediately.
        </p>
      </div>

      <div className="card">
        <h2>Account</h2>
        <p className="muted" style={{ marginTop: 0, marginBottom: 0 }}>
          Signed in as <strong>{user.email}</strong>.
        </p>
      </div>
    </div>
  );
}

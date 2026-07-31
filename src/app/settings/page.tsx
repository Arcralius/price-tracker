import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { SchedulePanel } from "./SchedulePanel";
import { ListsPanel } from "./ListsPanel";
import { TelegramPanel } from "./TelegramPanel";
import { prisma } from "@/lib/db";
import { getUser } from "@/lib/session";
import { describeSlots } from "@/lib/schedule";
import { getBotUsername, telegramEnabled } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const enabled = telegramEnabled();
  const botUsername = enabled ? await getBotUsername() : null;

  const lists = await prisma.itemList.findMany({
    where: { userId: user.id },
    orderBy: { name: "asc" },
    include: { _count: { select: { items: true } } },
  });

  return (
    <Shell
      email={user.email}
      active="settings"
      title="Settings"
      subtitle={`${describeSlots(user.notifyTimes)} · ${user.timezone}`}
    >
      <SchedulePanel timezone={user.timezone} notifyTimes={user.notifyTimes} />

      <ListsPanel lists={lists.map((l) => ({ id: l.id, name: l.name, count: l._count.items }))} />

      <TelegramPanel
        enabled={enabled}
        botUsername={botUsername}
        linkCode={user.linkCode}
        chatId={user.telegramChatId}
      />

      <div className="card">
        <div className="card-head">
          <div>
            <h2>How checking works</h2>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Prices are refreshed just before each of your delivery times, so the figure you&apos;re sent is
          the one on the site now. A separate daily sweep at{" "}
          <code className="inline">{process.env.CHECK_CRON || "09:00"}</code> records history for
          everything, whether or not you have alerts on. You can also force a check for a single item
          from its page.
        </p>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Account</h2>
          </div>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Signed in as <strong>{user.email}</strong>.
        </p>
      </div>
    </Shell>
  );
}

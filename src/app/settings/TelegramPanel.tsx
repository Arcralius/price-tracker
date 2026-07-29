"use client";

import { useActionState } from "react";
import {
  checkTelegramLink,
  refreshLinkCode,
  sendTestMessage,
  setChatIdManually,
  unlinkTelegram,
  type ActionState,
} from "@/app/actions/items";
import { SubmitButton } from "@/components/SubmitButton";

export function TelegramPanel({
  enabled,
  botUsername,
  linkCode,
  chatId,
}: {
  enabled: boolean;
  botUsername: string | null;
  linkCode: string;
  chatId: string | null;
}) {
  const [linkState, linkAction] = useActionState<ActionState, FormData>(
    async (prev) => checkTelegramLink(prev),
    {}
  );
  const [manualState, manualAction] = useActionState<ActionState, FormData>(setChatIdManually, {});
  const [testState, testAction] = useActionState<ActionState, FormData>(async (prev) => sendTestMessage(prev), {});

  if (!enabled) {
    return (
      <div className="card">
        <h2>Telegram alerts</h2>
        <p className="muted" style={{ marginTop: 0, marginBottom: 0 }}>
          Not configured. Create a bot with{" "}
          <a href="https://t.me/BotFather" target="_blank" rel="noreferrer noopener">
            @BotFather
          </a>
          , then set <code className="inline">TELEGRAM_BOT_TOKEN</code> in your{" "}
          <code className="inline">.env</code> and restart.
        </p>
      </div>
    );
  }

  const startLink = botUsername ? `https://t.me/${botUsername}?start=${linkCode}` : null;

  return (
    <div className="card">
      <h2>Telegram alerts</h2>

      {linkState.error && <div className="alert error">{linkState.error}</div>}
      {linkState.message && <div className="alert ok">{linkState.message}</div>}
      {manualState.error && <div className="alert error">{manualState.error}</div>}
      {manualState.message && <div className="alert ok">{manualState.message}</div>}
      {testState.error && <div className="alert error">{testState.error}</div>}
      {testState.message && <div className="alert ok">{testState.message}</div>}

      {chatId ? (
        <>
          <p style={{ marginTop: 0 }}>
            ✅ Linked to chat <code className="inline">{chatId}</code>. You&apos;ll get a message whenever
            something you track drops in price.
          </p>
          <div className="row">
            <form action={testAction}>
              <SubmitButton className="secondary" pendingLabel="Sending…">
                Send test message
              </SubmitButton>
            </form>
            <form action={unlinkTelegram}>
              <SubmitButton className="danger" pendingLabel="Unlinking…">
                Unlink
              </SubmitButton>
            </form>
          </div>
        </>
      ) : (
        <>
          <p style={{ marginTop: 0 }}>
            {startLink ? (
              <>
                Open{" "}
                <a href={startLink} target="_blank" rel="noreferrer noopener">
                  @{botUsername}
                </a>{" "}
                and press Start — the link already carries your code.
              </>
            ) : (
              <>Message your bot on Telegram to link it.</>
            )}
          </p>
          <p className="muted" style={{ marginTop: 0 }}>
            Or send it this message yourself:{" "}
            <code className="inline">/start {linkCode}</code>
          </p>

          <div className="row" style={{ marginBottom: 18 }}>
            <form action={linkAction}>
              <SubmitButton pendingLabel="Checking…">I&apos;ve sent it — check now</SubmitButton>
            </form>
            <form action={refreshLinkCode}>
              <SubmitButton className="secondary" pendingLabel="…">
                New code
              </SubmitButton>
            </form>
          </div>

          <details>
            <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>
              Enter a chat ID manually instead
            </summary>
            <form action={manualAction} style={{ marginTop: 12, maxWidth: 320 }}>
              <label htmlFor="chatId">
                Your numeric chat ID — get it from{" "}
                <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer noopener">
                  @userinfobot
                </a>
              </label>
              <input id="chatId" name="chatId" type="text" placeholder="123456789" />
              <div style={{ marginTop: 10 }}>
                <SubmitButton className="secondary" pendingLabel="Saving…">
                  Save chat ID
                </SubmitButton>
              </div>
            </form>
          </details>
        </>
      )}

      <p className="muted" style={{ fontSize: 12.5, marginBottom: 0, marginTop: 18 }}>
        You must message the bot first — Telegram doesn&apos;t let bots start conversations.
      </p>
    </div>
  );
}

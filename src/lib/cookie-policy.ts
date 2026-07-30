/**
 * Whether the session cookie carries the `Secure` attribute.
 *
 * A `Secure` cookie is silently discarded by the browser over plain http, which
 * makes login look like it succeeded and then bounce straight back to /login.
 * That is correct behaviour behind HTTPS, but wrong when the app is reached
 * directly over http on a LAN (a bare container on Unraid, say), so it can be
 * opted out of.
 *
 * Only ever set COOKIE_SECURE=false for a LAN-only deployment: over the open
 * internet it lets the session cookie travel in cleartext.
 */
export function cookieSecure(env: NodeJS.ProcessEnv = process.env): boolean {
  const setting = env.COOKIE_SECURE?.trim().toLowerCase();
  if (setting === "false" || setting === "0" || setting === "no") return false;
  if (setting === "true" || setting === "1" || setting === "yes") return true;
  return env.NODE_ENV === "production";
}

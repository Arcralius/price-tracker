import { createHmac, timingSafeEqual, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { cookieSecure } from "./cookie-policy";
import { prisma } from "./db";

const COOKIE = "pt_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error("SESSION_SECRET is missing or too short — see .env.example");
  }
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** Token format: <userId>.<expiryEpochSeconds>.<hmac> */
function mint(userId: string): string {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  const payload = `${userId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

function verify(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, exp, mac] = parts;

  const expected = Buffer.from(sign(`${userId}.${exp}`));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  if (Number(exp) < Math.floor(Date.now() / 1000)) return null;
  return userId;
}

export async function createSession(userId: string) {
  const jar = await cookies();
  jar.set(COOKIE, mint(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/** Returns the signed-in user, or null. */
export async function getUser() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;

  const userId = verify(token);
  if (!userId) return null;

  return prisma.user.findUnique({ where: { id: userId } });
}

/** Same as getUser but throws — for routes that are already behind a redirect guard. */
export async function requireUser() {
  const user = await getUser();
  if (!user) throw new Error("Not authenticated");
  return user;
}

export function newLinkCode(): string {
  return randomBytes(4).toString("hex");
}

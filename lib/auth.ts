import { UserError } from "./errors";
import { createHash } from "node:crypto";
import { getDb } from "@/lib/database";

export type User = { id: string; nickname: string; avatar: string | null; last_seen?: string };
export function avatarUrl(userId: string, avatar: string | null) {
  return avatar
    ? `/api/avatar/${userId}?v=${createHash("sha1").update(avatar).digest("hex").slice(0, 12)}`
    : null;
}
export function cookieUserId(request: Request) {
  const header = request.headers.get("cookie") ?? "";
  const match = header.match(/(?:^|;\s*)poker_user=([^;]+)/);
  try {
    return match ? decodeURIComponent(match[1]) : undefined;
  } catch {
    return undefined;
  }
}
export function currentUser(request: Request, touch = true): User | null {
  const id = cookieUserId(request);
  if (!id) return null;
  const db = getDb();
  if (touch)
    db.prepare(
      "UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ? AND last_seen < datetime('now', '-3 seconds')",
    ).run(id);
  return (
    (db.prepare("SELECT id, nickname, avatar, last_seen FROM users WHERE id = ?").get(id) as
      User | undefined) ?? null
  );
}
export function requireUser(request: Request) {
  const user = currentUser(request);
  if (!user) throw new UserError("请先注册昵称", 401);
  return user;
}

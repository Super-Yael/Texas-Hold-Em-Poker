import { errorResponse } from "@/lib/http";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/database";
import { avatarUrl, requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const me = requireUser(request);
    const users = getDb()
      .prepare(
        `SELECT u.id, u.nickname, u.avatar, u.last_seen AS lastSeen,
      EXISTS (SELECT 1 FROM room_members m JOIN rooms r ON r.id = m.room_id WHERE m.user_id = u.id AND r.status != 'closed') AS busy
      FROM users u WHERE u.id != ? ORDER BY u.last_seen DESC, u.nickname COLLATE NOCASE`,
      )
      .all(me.id) as Array<{
      id: string;
      nickname: string;
      avatar: string | null;
      lastSeen: string;
      busy: number;
    }>;
    const now = Date.now();
    return NextResponse.json({
      users: users.map((u) => ({
        id: u.id,
        nickname: u.nickname,
        avatar: avatarUrl(u.id, u.avatar),
        busy: !!u.busy,
        online: now - new Date(`${u.lastSeen.replace(" ", "T")}Z`).getTime() < 45_000,
      })),
    });
  } catch (error) {
    return errorResponse(error, "玩家列表载入失败");
  }
}

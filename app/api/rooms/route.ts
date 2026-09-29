import { UserError } from "@/lib/errors";
import { assertMutationOrigin } from "@/lib/request-security";
import { roomChanged } from "@/lib/events";
import { errorResponse } from "@/lib/http";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/database";
import { requireUser } from "@/lib/auth";
import { closeExpiredRooms, currentRoomFor, roomView } from "@/lib/rooms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = requireUser(request);
    closeExpiredRooms();
    const active = currentRoomFor(user.id);
    return NextResponse.json({ view: active ? roomView(active.id, user.id) : null });
  } catch (error) {
    return errorResponse(error, "房间载入失败");
  }
}

export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    const user = requireUser(request);
    const db = getDb();
    const create = db.transaction(() => {
      const existing = currentRoomFor(user.id);
      if (existing) throw new UserError("你已经在一个房间里了");
      const id = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
      db.prepare("INSERT INTO rooms (id, host_id, status) VALUES (?, ?, 'lobby')").run(id, user.id);
      db.prepare("INSERT INTO room_members (room_id, user_id, seat) VALUES (?, ?, 0)").run(
        id,
        user.id,
      );
      return id;
    });
    const roomId = create.immediate();
    roomChanged(roomId, user.id);
    return NextResponse.json({ view: roomView(roomId, user.id) });
  } catch (error) {
    return errorResponse(error, "创建房间失败");
  }
}

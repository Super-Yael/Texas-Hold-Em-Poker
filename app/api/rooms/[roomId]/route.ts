import { errorResponse, readJson } from "@/lib/http";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { closeExpiredRooms, roomView } from "@/lib/rooms";
import { executeRoomAction } from "@/lib/room-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ roomId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const user = requireUser(request);
    closeExpiredRooms();
    const { roomId } = await context.params;
    return NextResponse.json({ view: roomView(roomId, user.id) });
  } catch (error) {
    return errorResponse(error, "房间载入失败");
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const user = requireUser(request);
    const { roomId } = await context.params;
    const body: unknown = await readJson(request);
    const result = executeRoomAction(roomId, user.id, body);
    return NextResponse.json({
      view: result.left ? null : roomView(roomId, user.id),
      closed: result.closed,
    });
  } catch (error) {
    return errorResponse(error, "房间操作失败");
  }
}

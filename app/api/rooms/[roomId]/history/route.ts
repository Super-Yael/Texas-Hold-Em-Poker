import { errorResponse } from "@/lib/http";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { roomMatchHistory } from "@/lib/rooms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ roomId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const user = requireUser(request);
    const { roomId } = await context.params;
    return NextResponse.json({ matches: roomMatchHistory(roomId, user.id) });
  } catch (error) {
    return errorResponse(error, "对局历史载入失败");
  }
}

import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { accountHandHistory } from "@/lib/rooms";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = requireUser(request);
    return NextResponse.json({ matches: accountHandHistory(user.id) });
  } catch (error) {
    return errorResponse(error, "账号历史记录载入失败");
  }
}

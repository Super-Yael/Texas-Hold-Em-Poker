import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listInvitations, changeInvitation } from "@/lib/invitations";
import { readJson, errorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = requireUser(request);
    return NextResponse.json(
      listInvitations(user.id, new URL(request.url).searchParams.get("roomId")),
    );
  } catch (error) {
    return errorResponse(error, "邀请载入失败");
  }
}

export async function POST(request: Request) {
  try {
    const user = requireUser(request);
    return NextResponse.json(changeInvitation(user, await readJson(request)));
  } catch (error) {
    return errorResponse(error, "邀请操作失败");
  }
}

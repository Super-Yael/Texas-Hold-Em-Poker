import { roomChanged } from "@/lib/events";
import { currentRoomFor } from "@/lib/rooms";
import { readJson, errorResponse } from "@/lib/http";
import { assertMutationOrigin } from "@/lib/request-security";
import { UserError } from "@/lib/errors";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/database";
import { avatarUrl, currentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = currentUser(request);
  return NextResponse.json({
    user: user
      ? { id: user.id, nickname: user.nickname, avatar: avatarUrl(user.id, user.avatar) }
      : null,
  });
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request, 720_000);

    if (body.action === "update-avatar") {
      const user = currentUser(request);
      if (!user) return NextResponse.json({ error: "请先登录后再修改头像" }, { status: 401 });
      if (body.avatar !== null && typeof body.avatar !== "string")
        return NextResponse.json({ error: "请选择要上传的头像" }, { status: 400 });
      const avatar = body.avatar;
      if (
        avatar &&
        (avatar.length > 700_000 ||
          !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar))
      ) {
        return NextResponse.json(
          { error: "头像请使用小于 500KB 的 PNG、JPG 或 WebP 图片" },
          { status: 400 },
        );
      }
      getDb()
        .prepare("UPDATE users SET avatar = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?")
        .run(avatar, user.id);
      const active = currentRoomFor(user.id);
      if (active) roomChanged(active.id, user.id);
      return NextResponse.json({
        user: { id: user.id, nickname: user.nickname, avatar: avatarUrl(user.id, avatar) },
      });
    }

    const nickname = typeof body.nickname === "string" ? body.nickname.trim() : "";
    if (!nickname) return NextResponse.json({ error: "昵称为必填项" }, { status: 400 });
    if (nickname.length > 16)
      return NextResponse.json({ error: "昵称最多 16 个字符" }, { status: 400 });

    if (body.action === "login") {
      const existing = getDb()
        .prepare("SELECT id, nickname, avatar FROM users WHERE nickname = ? COLLATE NOCASE")
        .get(nickname) as { id: string; nickname: string; avatar: string | null } | undefined;
      if (!existing)
        return NextResponse.json(
          { error: "找不到这个昵称，请检查输入或先创建资料" },
          { status: 404 },
        );
      getDb()
        .prepare("UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?")
        .run(existing.id);
      const response = NextResponse.json({
        user: {
          id: existing.id,
          nickname: existing.nickname,
          avatar: avatarUrl(existing.id, existing.avatar),
        },
      });
      response.cookies.set("poker_user", existing.id, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
      return response;
    }
    if (body.action && body.action !== "register")
      return NextResponse.json({ error: "无法识别的身份操作" }, { status: 400 });

    if (body.avatar != null && typeof body.avatar !== "string") throw new UserError("头像格式无效");
    const avatar = body.avatar || null;
    if (
      avatar &&
      (avatar.length > 700_000 ||
        !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(avatar))
    ) {
      return NextResponse.json(
        { error: "头像请使用小于 500KB 的 PNG、JPG 或 WebP 图片" },
        { status: 400 },
      );
    }
    const id = randomUUID();
    getDb()
      .prepare("INSERT INTO users (id, nickname, avatar) VALUES (?, ?, ?)")
      .run(id, nickname, avatar);
    const response = NextResponse.json({ user: { id, nickname, avatar: avatarUrl(id, avatar) } });
    response.cookies.set("poker_user", id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE"))
      return errorResponse(new UserError("这个昵称已经被使用，请换一个昵称", 409), "注册失败");
    return errorResponse(error, "账号操作失败");
  }
}

export async function DELETE(request: Request) {
  try {
    assertMutationOrigin(request);
  } catch (error) {
    return errorResponse(error, "退出失败");
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set("poker_user", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

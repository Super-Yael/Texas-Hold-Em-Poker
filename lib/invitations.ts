import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/database";
import { avatarUrl, type User } from "@/lib/auth";
import { closeExpiredRooms, compactRoomSeats, currentRoomFor } from "@/lib/rooms";
import { readRoomSettings } from "@/lib/settings";
import { addPlayerBetweenHands, type PokerState } from "@/lib/poker";

import { roomChanged } from "./events";
import { UserError } from "./errors";
import { object, text } from "./validation";

function roomAcceptsPlayers(room: { status: string; game_json: string | null }) {
  if (room.status === "lobby") return true;
  if (room.status !== "playing" || !room.game_json) return false;
  const game = JSON.parse(room.game_json) as PokerState;
  return game.stage === "complete" && !game.closeRequest;
}

export function listInvitations(userId: string, roomId: string | null) {
  closeExpiredRooms();
  const db = getDb();
  const incomingRows = db
    .prepare(
      `SELECT i.id, i.room_id AS roomId, i.from_id AS fromId, u.nickname AS fromName, r.status AS roomStatus, r.game_json AS gameJson, i.created_at AS createdAt
    FROM invitations i JOIN users u ON u.id = i.from_id JOIN rooms r ON r.id = i.room_id
    WHERE i.to_id = ? AND i.status = 'pending' ORDER BY i.created_at DESC`,
    )
    .all(userId) as Array<{
    id: string;
    roomId: string;
    fromId: string;
    fromName: string;
    roomStatus: string;
    gameJson: string | null;
    createdAt: string;
  }>;
  const incoming = incomingRows
    .filter((item) => roomAcceptsPlayers({ status: item.roomStatus, game_json: item.gameJson }))
    .map(({ gameJson, ...item }) => item);
  const outgoing = roomId
    ? db
        .prepare(
          `SELECT i.id, i.to_id AS userId, u.nickname, i.status, i.created_at AS createdAt
    FROM invitations i JOIN users u ON u.id = i.to_id WHERE i.room_id = ? AND i.from_id = ? ORDER BY i.created_at DESC`,
        )
        .all(roomId, userId)
    : [];
  return { incoming, outgoing };
}

export function changeInvitation(me: User, input: unknown) {
  const raw = object(input);
  if (raw.action !== "invite" && raw.action !== "accept" && raw.action !== "decline")
    throw new UserError("无法识别的邀请操作");
  const body =
    raw.action === "invite"
      ? {
          action: raw.action,
          roomId: text(raw.roomId, "房间"),
          userId: text(raw.userId, "玩家"),
          invitationId: undefined,
        }
      : {
          action: raw.action,
          invitationId: text(raw.invitationId, "邀请"),
          roomId: undefined,
          userId: undefined,
        };
  closeExpiredRooms();
  const db = getDb();
  if (body.action === "invite") {
    const roomId = body.roomId;
    const targetId = body.userId;
    if (!roomId || !targetId) throw new UserError("请选择一位玩家");
    const invite = db.transaction(() => {
      const room = db
        .prepare("SELECT id, host_id, status, game_json, settings_json FROM rooms WHERE id = ?")
        .get(roomId) as
        | {
            id: string;
            host_id: string;
            status: string;
            game_json: string | null;
            settings_json: string | null;
          }
        | undefined;
      if (!room || room.host_id !== me.id || !roomAcceptsPlayers(room))
        throw new UserError("只有房主能在两手之间邀请玩家");
      if (
        targetId === me.id ||
        db
          .prepare("SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?")
          .get(room.id, targetId)
      )
        throw new UserError("该玩家已经在房间里");
      if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(targetId))
        throw new UserError("找不到这位玩家");
      const busy = currentRoomFor(targetId);
      if (busy) throw new UserError("这位玩家已经在另一个房间里");
      const existing = db
        .prepare("SELECT id, status FROM invitations WHERE room_id = ? AND to_id = ?")
        .get(room.id, targetId) as { id: string; status: string } | undefined;
      if (existing?.status === "pending")
        return { ok: true, invitationId: existing.id, changed: false };
      const members = (
        db.prepare("SELECT COUNT(*) AS count FROM room_members WHERE room_id = ?").get(room.id) as {
          count: number;
        }
      ).count;
      const pending = (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM invitations WHERE room_id = ? AND status = 'pending'",
          )
          .get(room.id) as { count: number }
      ).count;
      const maxPlayers = readRoomSettings(room.settings_json).maxPlayers;
      if (members + pending >= maxPlayers)
        throw new UserError(`房间的 ${maxPlayers} 个座位已被占满`);
      const id = randomUUID();
      db.prepare(
        `INSERT INTO invitations (id, room_id, from_id, to_id, status) VALUES (?, ?, ?, ?, 'pending')
        ON CONFLICT(room_id, to_id) DO UPDATE SET id = excluded.id, from_id = excluded.from_id, status = 'pending', updated_at = CURRENT_TIMESTAMP`,
      ).run(id, room.id, me.id, targetId);
      return { ok: true, invitationId: id, changed: true };
    });
    const result = invite.immediate();
    if (result.changed) roomChanged(roomId, me.id);
    const { changed: _changed, ...response } = result;
    return response;
  }
  if (body.action === "accept" || body.action === "decline") {
    if (!body.invitationId) throw new UserError("邀请不存在");
    const respond = db.transaction(() => {
      const invitation = db
        .prepare("SELECT id, room_id, status FROM invitations WHERE id = ? AND to_id = ?")
        .get(body.invitationId, me.id) as
        { id: string; room_id: string; status: string } | undefined;
      if (!invitation || invitation.status !== "pending") throw new UserError("这条邀请已经失效");
      if (body.action === "decline") {
        db.prepare(
          "UPDATE invitations SET status = 'declined', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        ).run(invitation.id);
        return { ok: true, roomId: invitation.room_id };
      }
      const room = db
        .prepare("SELECT status, game_json, settings_json FROM rooms WHERE id = ?")
        .get(invitation.room_id) as
        { status: string; game_json: string | null; settings_json: string | null } | undefined;
      if (!room || !roomAcceptsPlayers(room))
        throw new UserError("请等当前手结束后再加入，或房间已关闭");
      const current = currentRoomFor(me.id);
      if (current && current.id !== invitation.room_id)
        throw new UserError("请先退出当前房间，再接受新邀请");
      const count = (
        db
          .prepare("SELECT COUNT(*) AS count FROM room_members WHERE room_id = ?")
          .get(invitation.room_id) as { count: number }
      ).count;
      const settings = readRoomSettings(room.settings_json);
      if (count >= settings.maxPlayers) throw new UserError("这个房间已经满员");
      if (room.status === "playing") compactRoomSeats(invitation.room_id);
      const occupied = new Set(
        (
          db
            .prepare("SELECT seat FROM room_members WHERE room_id = ?")
            .all(invitation.room_id) as Array<{ seat: number }>
        ).map((x) => x.seat),
      );
      const seat = Array.from({ length: settings.maxPlayers }, (_, index) => index).find(
        (n) => !occupied.has(n),
      );
      if (seat === undefined) throw new UserError("没有空座位了");
      db.prepare("INSERT INTO room_members (room_id, user_id, seat) VALUES (?, ?, ?)").run(
        invitation.room_id,
        me.id,
        seat,
      );
      if (room.status === "playing" && room.game_json) {
        const game = JSON.parse(room.game_json) as PokerState;
        addPlayerBetweenHands(
          game,
          { id: me.id, name: me.nickname, avatar: avatarUrl(me.id, me.avatar) },
          settings.startingStack,
        );
        db.prepare("UPDATE rooms SET game_json = ? WHERE id = ?").run(
          JSON.stringify(game),
          invitation.room_id,
        );
      }
      db.prepare(
        "UPDATE invitations SET status = 'accepted', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      ).run(invitation.id);
      return { ok: true, roomId: invitation.room_id };
    });
    const result = respond.immediate();
    roomChanged(result.roomId, me.id);
    return result;
  }
  throw new UserError("无法识别的邀请操作");
}

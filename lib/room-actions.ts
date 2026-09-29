import { getDb } from "@/lib/database";
import { avatarUrl } from "@/lib/auth";
import {
  closeExpiredRooms,
  compactRoomSeats,
  isRoomMember,
  recordHand,
  roomMembers,
} from "@/lib/rooms";
import {
  addChipsBetweenHands,
  configureNextHand,
  createGame,
  removePlayerBetweenHands,
  startGameHand,
  takeAction,
  type PokerState,
} from "@/lib/poker";
import { readRoomSettings } from "@/lib/settings";

import { parseRoomAction, type RoomAction } from "./room-command";
import { roomChanged } from "./events";
import { UserError } from "./errors";

type Room = {
  id: string;
  host_id: string;
  status: "lobby" | "playing" | "closed";
  game_json: string | null;
  settings_json: string | null;
};

export function executeRoomAction(roomId: string, userId: string, input: unknown) {
  const body = parseRoomAction(input);
  closeExpiredRooms();
  const result = applyRoomAction(roomId, userId, body);
  roomChanged(roomId, userId);
  return result;
}

function applyRoomAction(roomId: string, userId: string, body: RoomAction) {
  const db = getDb();
  const currentRoom = () => {
    const room = db
      .prepare("SELECT id, host_id, status, game_json, settings_json FROM rooms WHERE id = ?")
      .get(roomId) as Room | undefined;
    if (!room || !isRoomMember(roomId, userId)) throw new UserError("房间不存在或你已离开");
    return room;
  };

  if (body.action === "settings") {
    db.transaction(() => {
      const room = currentRoom();
      if (room.host_id !== userId) throw new UserError("只有房主可以修改牌桌设置");
      const settings = body.settings;
      const members = roomMembers(roomId);
      const pending = (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM invitations WHERE room_id = ? AND status = 'pending'",
          )
          .get(roomId) as { count: number }
      ).count;
      if (members.length + pending > settings.maxPlayers)
        throw new UserError("当前玩家和待接受邀请已超过新的人数上限");
      if (room.status === "lobby") {
        compactRoomSeats(roomId);
        db.prepare("UPDATE rooms SET settings_json = ? WHERE id = ?").run(
          JSON.stringify(settings),
          roomId,
        );
      } else if (room.status === "playing" && room.game_json) {
        const state = JSON.parse(room.game_json) as PokerState;
        configureNextHand(
          state,
          settings,
          readRoomSettings(room.settings_json),
          body.resetBlinds === true,
        );
        db.prepare("UPDATE rooms SET settings_json = ?, game_json = ? WHERE id = ?").run(
          JSON.stringify(settings),
          JSON.stringify(state),
          roomId,
        );
      } else {
        throw new UserError("这个房间不能修改设置");
      }
    }).immediate();
    return { left: false };
  }

  if (body.action === "add-chips" || body.action === "kick") {
    db.transaction(() => {
      const room = currentRoom();
      if (room.status !== "playing" || !room.game_json || room.host_id !== userId)
        throw new UserError("只有房主可以管理局内玩家");
      const targetId = body.userId;
      if (!targetId || !isRoomMember(roomId, targetId)) throw new UserError("玩家不在牌桌中");
      const state = JSON.parse(room.game_json) as PokerState;
      if (body.action === "add-chips") {
        addChipsBetweenHands(state, targetId, body.amount);
      } else {
        if (targetId === userId) throw new UserError("房主不能移除自己，请使用关闭房间");
        if (roomMembers(roomId).length <= 2)
          throw new UserError("牌桌至少保留 2 人；请使用关闭房间");
        removePlayerBetweenHands(state, targetId);
        db.prepare("DELETE FROM invitations WHERE room_id = ? AND to_id = ?").run(roomId, targetId);
        db.prepare("DELETE FROM room_members WHERE room_id = ? AND user_id = ?").run(
          roomId,
          targetId,
        );
        compactRoomSeats(roomId);
      }
      db.prepare("UPDATE rooms SET game_json = ? WHERE id = ?").run(JSON.stringify(state), roomId);
    }).immediate();
    return { left: false };
  }

  if (body.action === "request-close" || body.action === "close-vote") {
    const result = db
      .transaction(() => {
        const latest = currentRoom();
        if (latest.status !== "playing" || !latest.game_json)
          throw new UserError("牌桌已经关闭或尚未开始");
        const state = JSON.parse(latest.game_json) as PokerState;
        if (body.action === "request-close") {
          if (!state.closeRequest) {
            const requester = roomMembers(roomId).find((member) => member.id === userId);
            state.closeRequest = {
              requestedById: userId,
              requestedByName: requester?.nickname ?? "玩家",
              approvals: [userId],
              createdAt: Date.now(),
            };
            db.prepare("UPDATE rooms SET game_json = ?, close_requested_at = ? WHERE id = ?").run(
              JSON.stringify(state),
              state.closeRequest.createdAt,
              roomId,
            );
          }
          return { closed: false };
        }

        if (!state.closeRequest) throw new UserError("当前没有待确认的关闭申请");
        if (body.approve === false) {
          state.closeRequest = null;
          db.prepare("UPDATE rooms SET game_json = ?, close_requested_at = NULL WHERE id = ?").run(
            JSON.stringify(state),
            roomId,
          );
          return { closed: false };
        }
        if (body.approve !== true) throw new UserError("请选择同意或取消申请");

        const members = roomMembers(roomId);
        const memberIds = new Set(members.map((member) => member.id));
        const approvals = new Set(state.closeRequest.approvals ?? []);
        approvals.add(userId);
        state.closeRequest.approvals = [...approvals].filter((id) => memberIds.has(id));
        if (state.closeRequest.approvals.length >= 2) {
          db.prepare("DELETE FROM poker_hands WHERE room_id = ?").run(roomId);
          db.prepare("DELETE FROM invitations WHERE room_id = ?").run(roomId);
          db.prepare("DELETE FROM room_members WHERE room_id = ?").run(roomId);
          db.prepare("DELETE FROM rooms WHERE id = ?").run(roomId);
          return { closed: true };
        }
        db.prepare("UPDATE rooms SET game_json = ? WHERE id = ?").run(
          JSON.stringify(state),
          roomId,
        );
        return { closed: false };
      })
      .immediate();
    return { left: result.closed, closed: result.closed };
  }

  if (body.action === "start") {
    db.transaction(() => {
      const room = currentRoom();
      if (room.status !== "lobby" || room.host_id !== userId)
        throw new UserError("只有房主可以开始游戏");
      const members = roomMembers(roomId);
      const settings = readRoomSettings(room.settings_json);
      if (members.length < 2) throw new UserError("至少邀请 1 位玩家后才能开始");
      if (members.length > settings.maxPlayers)
        throw new UserError(`德州扑克房间最多 ${settings.maxPlayers} 人`);
      const game = createGame(
        roomId,
        members.map((m) => ({ id: m.id, name: m.nickname, avatar: avatarUrl(m.id, m.avatar) })),
        settings,
      );
      startGameHand(game);
      db.prepare("UPDATE rooms SET status = 'playing', game_json = ? WHERE id = ?").run(
        JSON.stringify(game),
        roomId,
      );
    }).immediate();
    return { left: false };
  }

  if (body.action === "act") {
    db.transaction(() => {
      const room = currentRoom();
      if (room.status !== "playing" || !room.game_json) throw new UserError("這手牌還沒有開始");
      const state = JSON.parse(room.game_json) as PokerState;
      if (state.closeRequest) throw new UserError("牌桌正在等待关闭确认");
      takeAction(state, userId, body.kind, body.raiseTo);
      db.prepare("UPDATE rooms SET game_json = ? WHERE id = ?").run(JSON.stringify(state), roomId);
      recordHand(state);
    }).immediate();
    return { left: false };
  }

  if (body.action === "next") {
    db.transaction(() => {
      const latest = currentRoom();
      if (latest.status !== "playing" || !latest.game_json) throw new UserError("牌桌尚未开始");
      const state = JSON.parse(latest.game_json) as PokerState;
      if (state.closeRequest) throw new UserError("牌桌正在等待关闭确认");
      if (state.stage !== "complete") throw new UserError("当前牌局尚未结束");
      if (state.matchWinnerId) throw new UserError("整场对局已经结束");

      const members = roomMembers(roomId);
      const memberIds = new Set(members.map((member) => member.id));
      const eligibleIds = new Set(
        state.players
          .filter((player) => !player.eliminated && player.stack > 0 && memberIds.has(player.id))
          .map((player) => player.id),
      );
      if (!eligibleIds.has(userId)) throw new UserError("淘汰玩家无需投票继续");
      const votes = new Set((state.continueVotes ?? []).filter((id) => eligibleIds.has(id)));
      if (body.approve === false) votes.delete(userId);
      else votes.add(userId);

      if (eligibleIds.size > 0 && [...eligibleIds].every((id) => votes.has(id))) {
        startGameHand(state, true);
        db.prepare("UPDATE rooms SET game_json = ? WHERE id = ?").run(
          JSON.stringify(state),
          roomId,
        );
        recordHand(state);
      } else {
        state.continueVotes = [...votes];
        db.prepare("UPDATE rooms SET game_json = ? WHERE id = ?").run(
          JSON.stringify(state),
          roomId,
        );
      }
    }).immediate();
    return { left: false };
  }

  if (body.action === "rematch") {
    db.transaction(() => {
      const latest = currentRoom();
      if (latest.status !== "playing" || !latest.game_json) throw new UserError("牌桌尚未开始");
      const previous = JSON.parse(latest.game_json) as PokerState;
      if (previous.closeRequest) throw new UserError("牌桌正在等待关闭确认");
      if (previous.stage !== "complete" || !previous.matchWinnerId)
        throw new UserError("整场对局尚未结束");

      const members = roomMembers(roomId);
      const settings = readRoomSettings(latest.settings_json);
      if (members.length < 2 || members.length > settings.maxPlayers)
        throw new UserError(`牌桌需要 2 到 ${settings.maxPlayers} 位玩家才能继续对局`);
      const memberIds = new Set(members.map((member) => member.id));
      const eligibleIds = new Set(
        previous.matchWinnerId && !memberIds.has(previous.matchWinnerId)
          ? members.map((member) => member.id)
          : previous.players
              .filter(
                (player) => !player.eliminated && player.stack > 0 && memberIds.has(player.id),
              )
              .map((player) => player.id),
      );
      if (!eligibleIds.has(userId)) throw new UserError("淘汰玩家无需投票继续");
      const votes = new Set((previous.continueVotes ?? []).filter((id) => eligibleIds.has(id)));
      if (body.approve === false) votes.delete(userId);
      else votes.add(userId);

      if (eligibleIds.size > 0 && [...eligibleIds].every((id) => votes.has(id))) {
        const previousButtonId = previous.players.find(
          (player) => player.seat === previous.buttonSeat,
        )?.id;
        const participants = members.map((member) => ({
          id: member.id,
          name: member.nickname,
          avatar: avatarUrl(member.id, member.avatar),
        }));
        const game = createGame(roomId, participants, settings);
        const previousButtonIndex = members.findIndex((member) => member.id === previousButtonId);
        game.buttonSeat = previousButtonIndex >= 0 ? (previousButtonIndex + 1) % members.length : 0;
        startGameHand(game);
        db.prepare("UPDATE rooms SET game_json = ? WHERE id = ?").run(JSON.stringify(game), roomId);
      } else {
        previous.continueVotes = [...votes];
        db.prepare("UPDATE rooms SET game_json = ? WHERE id = ?").run(
          JSON.stringify(previous),
          roomId,
        );
      }
    }).immediate();
    return { left: false };
  }

  if (body.action === "leave") {
    const leave = db.transaction(() => {
      const room = currentRoom();
      if (room.status === "playing" && room.game_json) {
        const state = JSON.parse(room.game_json) as PokerState;
        if (state.stage !== "complete") throw new UserError("请等这一手结束后再离开房间");
      }
      if (room.host_id === userId) {
        db.prepare("DELETE FROM poker_hands WHERE room_id = ?").run(roomId);
        db.prepare("DELETE FROM rooms WHERE id = ?").run(roomId);
        return { closed: true };
      }
      db.prepare("DELETE FROM invitations WHERE room_id = ? AND to_id = ?").run(roomId, userId);
      db.prepare("DELETE FROM room_members WHERE room_id = ? AND user_id = ?").run(roomId, userId);
      const remaining = roomMembers(roomId);
      if (room.status === "playing" && remaining.length < 2) {
        db.prepare("DELETE FROM poker_hands WHERE room_id = ?").run(roomId);
        db.prepare("DELETE FROM rooms WHERE id = ?").run(roomId);
        return { closed: true };
      }
      if (room.status === "playing" && room.game_json) {
        const state = JSON.parse(room.game_json) as PokerState;
        removePlayerBetweenHands(state, userId);
        compactRoomSeats(roomId);
        db.prepare("UPDATE rooms SET game_json = ? WHERE id = ?").run(
          JSON.stringify(state),
          roomId,
        );
      }
      return { closed: false };
    });
    leave.immediate();
    return { left: true };
  }

  throw new UserError("无法识别的房间操作");
}

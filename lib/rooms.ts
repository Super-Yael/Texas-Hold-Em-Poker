import { roomChanged } from "./events";
import { UserError } from "./errors";
import { getDb } from "@/lib/database";
import { avatarUrl } from "@/lib/auth";
import { publicGame, type PokerState } from "@/lib/poker";
import { readRoomSettings } from "@/lib/settings";

export type RoomStatus = "lobby" | "playing" | "closed";
export const CLOSE_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
type RoomRow = {
  id: string;
  host_id: string;
  status: RoomStatus;
  game_json: string | null;
  settings_json: string | null;
  created_at: string;
};
type MemberRow = {
  id: string;
  nickname: string;
  avatar: string | null;
  last_seen: string;
  seat: number;
};
export function currentRoomFor(userId: string) {
  return getDb()
    .prepare(
      `SELECT r.id, r.host_id, r.status, r.game_json, r.created_at
    FROM rooms r JOIN room_members m ON m.room_id = r.id
    WHERE m.user_id = ? AND r.status != 'closed' ORDER BY r.created_at DESC LIMIT 1`,
    )
    .get(userId) as RoomRow | undefined;
}
export function isRoomMember(roomId: string, userId: string) {
  return !!getDb()
    .prepare("SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?")
    .get(roomId, userId);
}
export function closeExpiredRooms(now = Date.now()) {
  const db = getDb();
  const deadline = now - CLOSE_REQUEST_TIMEOUT_MS;
  const query =
    "SELECT id FROM rooms WHERE status = 'playing' AND close_requested_at IS NOT NULL AND close_requested_at <= ?";
  if (!db.prepare(query).get(deadline)) return 0;
  const expired = db
    .transaction(() => {
      const rooms = db.prepare(query).all(deadline) as Array<{ id: string }>;
      for (const room of rooms) {
        db.prepare("DELETE FROM poker_hands WHERE room_id = ?").run(room.id);
        db.prepare("DELETE FROM rooms WHERE id = ?").run(room.id);
      }
      return rooms;
    })
    .immediate();
  for (const room of expired) roomChanged(room.id);
  return expired.length;
}
export function roomMembers(roomId: string) {
  return getDb()
    .prepare(
      `SELECT u.id, u.nickname, u.avatar, u.last_seen, m.seat
    FROM room_members m JOIN users u ON u.id = m.user_id
    WHERE m.room_id = ? ORDER BY m.seat`,
    )
    .all(roomId) as MemberRow[];
}
export function compactRoomSeats(roomId: string) {
  const db = getDb();
  const members = roomMembers(roomId);
  db.prepare("UPDATE room_members SET seat = seat + 6 WHERE room_id = ?").run(roomId);
  const update = db.prepare("UPDATE room_members SET seat = ? WHERE room_id = ? AND user_id = ?");
  for (const [seat, member] of members.entries()) update.run(seat, roomId, member.id);
  return members;
}
export function roomView(roomId: string, viewerId: string) {
  const row = getDb().prepare("SELECT * FROM rooms WHERE id = ?").get(roomId) as
    RoomRow | undefined;
  if (!row || !isRoomMember(roomId, viewerId)) throw new UserError("房间已关闭或你不在此房间");
  const members = roomMembers(roomId);
  const state = row.game_json ? (JSON.parse(row.game_json) as PokerState) : null;
  const outgoing = getDb()
    .prepare(
      `SELECT i.id, i.to_id AS userId, u.nickname, i.status, i.created_at AS createdAt
    FROM invitations i JOIN users u ON u.id = i.to_id WHERE i.room_id = ? AND i.from_id = ?
    ORDER BY i.created_at DESC`,
    )
    .all(roomId, viewerId) as Array<{
    id: string;
    userId: string;
    nickname: string;
    status: string;
    createdAt: string;
  }>;
  const now = Date.now();
  const publicMembers = members.map((m) => ({
    id: m.id,
    nickname: m.nickname,
    seat: m.seat,
    avatar: avatarUrl(m.id, m.avatar),
    online: now - new Date(`${m.last_seen.replace(" ", "T")}Z`).getTime() < 45_000,
  }));
  const game = state ? publicGame(state, viewerId) : null;
  if (game) {
    const avatars = new Map<string, string | null>(
      publicMembers.map((member) => [member.id, member.avatar]),
    );
    game.players = game.players.map((player) => ({
      ...player,
      avatar: avatars.get(player.id) ?? null,
    }));
  }
  return {
    room: {
      id: row.id,
      hostId: row.host_id,
      status: row.status,
      createdAt: row.created_at,
      settings: readRoomSettings(row.settings_json),
    },
    members: publicMembers,
    invitations: outgoing,
    game,
  };
}
export function recordHand(state: PokerState) {
  if (state.stage !== "complete") return;
  const matchWinner = state.matchWinnerId
    ? state.players.find((player) => player.id === state.matchWinnerId)
    : undefined;
  getDb()
    .prepare(
      "INSERT OR IGNORE INTO poker_hands (game_id, hand_no, room_id, summary_json) VALUES (?, ?, ?, ?)",
    )
    .run(
      state.gameId,
      state.handNo,
      state.roomId,
      JSON.stringify({
        handNo: state.handNo,
        board: state.board,
        outcome: state.outcome,
        winners: state.winners,
        matchWinner: matchWinner
          ? { id: matchWinner.id, name: matchWinner.name, chips: matchWinner.stack }
          : null,
        players: state.players.map(({ id, name, stack, hole, folded, handScore }) => ({
          id,
          name,
          stack,
          hole,
          folded,
          handScore,
        })),
      }),
    );
}

export type RoomMatchHistoryItem = {
  gameId: string;
  winnerId: string;
  winnerName: string;
  winnerChips: number;
  handCount: number;
  playerCount: number;
  completedAt: string;
};
type StoredHand = { game_id: string; hand_no: number; summary_json: string; completed_at: string };
type AccountStoredHand = StoredHand & { room_id: string };
type StoredPlayer = { id: string; name: string; stack: number; handScore?: { label: string } };
type StoredSummary = {
  outcome?: string;
  winners?: Array<{ id: string; name: string; amount: number; hand?: string }>;
  matchWinner?: { id: string; name: string; chips: number } | null;
  players?: StoredPlayer[];
};

export function roomMatchHistory(roomId: string, viewerId: string): RoomMatchHistoryItem[] {
  if (!isRoomMember(roomId, viewerId)) throw new UserError("房间不存在或你已离开");
  const currentRoom = getDb().prepare("SELECT game_json FROM rooms WHERE id = ?").get(roomId) as
    { game_json: string | null } | undefined;
  const currentGame = currentRoom?.game_json
    ? (JSON.parse(currentRoom.game_json) as PokerState)
    : null;
  const rows = getDb()
    .prepare(
      `SELECT game_id, hand_no, summary_json, completed_at FROM poker_hands
    WHERE room_id = ? ORDER BY completed_at DESC, hand_no DESC`,
    )
    .all(roomId) as StoredHand[];
  const games = new Map<
    string,
    { summary: StoredSummary; completedAt: string; handCount: number }
  >();
  for (const row of rows) {
    const entry = games.get(row.game_id);
    if (entry) entry.handCount = Math.max(entry.handCount, row.hand_no);
    else
      games.set(row.game_id, {
        summary: JSON.parse(row.summary_json) as StoredSummary,
        completedAt: row.completed_at,
        handCount: row.hand_no,
      });
  }
  return [...games.entries()].flatMap(([gameId, game]) => {
    if (currentGame?.gameId === gameId && !currentGame.matchWinnerId) return [];
    const players = game.summary.players ?? [];
    const lastStanding = players.filter((player) => player.stack > 0);
    const winner =
      game.summary.matchWinner ??
      (lastStanding.length === 1
        ? { id: lastStanding[0].id, name: lastStanding[0].name, chips: lastStanding[0].stack }
        : null);
    return winner
      ? [
          {
            gameId,
            winnerId: winner.id,
            winnerName: winner.name,
            winnerChips: winner.chips,
            handCount: game.handCount,
            playerCount: players.length,
            completedAt: game.completedAt,
          },
        ]
      : [];
  });
}

export type AccountHandHistoryItem = {
  gameId: string;
  roomId: string;
  handNo: number;
  outcome: string;
  winnerNames: string[];
  won: boolean;
  stack: number;
  playerCount: number;
  completedAt: string;
};

export function accountHandHistory(userId: string): AccountHandHistoryItem[] {
  const rows = getDb()
    .prepare(
      `SELECT h.game_id, h.room_id, h.hand_no, h.summary_json, h.completed_at
      FROM poker_hands h
      WHERE EXISTS (
        SELECT 1 FROM json_each(h.summary_json, '$.players') participant
        WHERE json_extract(participant.value, '$.id') = ?
      )
      ORDER BY h.completed_at DESC, h.hand_no DESC
      LIMIT 100`,
    )
    .all(userId) as AccountStoredHand[];

  return rows.flatMap((row) => {
    const summary = JSON.parse(row.summary_json) as StoredSummary;
    const players = summary.players ?? [];
    const player = players.find((entry) => entry.id === userId);
    if (!player) return [];
    const winners = summary.winners ?? [];
    return [
      {
        gameId: row.game_id,
        roomId: row.room_id,
        handNo: row.hand_no,
        outcome: summary.outcome ?? "本手结束",
        winnerNames: winners.map((winner) => winner.name),
        won: winners.some((winner) => winner.id === userId),
        stack: player.stack,
        playerCount: players.length,
        completedAt: row.completed_at,
      },
    ];
  });
}

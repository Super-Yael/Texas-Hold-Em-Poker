import type { roomView, RoomMatchHistoryItem } from "./rooms";
import type { User } from "./auth";

// Browser types are derived from the server's public response, never PokerState.
export type Profile = Pick<User, "id" | "nickname" | "avatar">;
export type ServerUser = Profile & { online: boolean; busy: boolean };
export type RoomView = ReturnType<typeof roomView>;
export type Game = NonNullable<RoomView["game"]>;
export type Player = Game["players"][number];
export type Member = RoomView["members"][number];
export type Invite = {
  id: string;
  roomId: string;
  fromId: string;
  fromName: string;
  createdAt: string;
};
export type MatchHistoryItem = RoomMatchHistoryItem;

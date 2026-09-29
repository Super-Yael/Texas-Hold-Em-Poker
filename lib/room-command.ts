import type { ActionKind } from "./poker";
import { validateRoomSettings, type RoomSettings } from "./settings";
import { UserError } from "./errors";
import { integer, object, optionalBoolean, text } from "./validation";

export type RoomAction =
  | { action: "settings"; settings: RoomSettings; resetBlinds?: boolean }
  | { action: "add-chips"; userId: string; amount: number }
  | { action: "kick"; userId: string }
  | { action: "act"; kind: ActionKind; raiseTo?: number }
  | { action: "close-vote"; approve: boolean }
  | { action: "next" | "rematch"; approve?: boolean }
  | { action: "start" }
  | { action: "request-close" }
  | { action: "leave" };

export function parseRoomAction(value: unknown): RoomAction {
  const raw = object(value);
  switch (raw.action) {
    case "settings":
      return {
        action: raw.action,
        settings: validateRoomSettings(raw.settings),
        resetBlinds: optionalBoolean(raw.resetBlinds),
      };
    case "add-chips":
      return {
        action: raw.action,
        userId: text(raw.userId, "玩家"),
        amount: integer(raw.amount, "补充筹码", 1, 10_000_000),
      };
    case "kick":
      return { action: raw.action, userId: text(raw.userId, "玩家") };
    case "act": {
      const kind = text(raw.kind, "行动") as ActionKind;
      if (!["fold", "check", "call", "raise", "all-in"].includes(kind))
        throw new UserError("无法识别的行动");
      return {
        action: raw.action,
        kind,
        ...(kind === "raise" ? { raiseTo: integer(raw.raiseTo, "加注筹码", 1) } : {}),
      };
    }
    case "close-vote": {
      const approve = optionalBoolean(raw.approve);
      if (approve === undefined) throw new UserError("请选择同意或取消申请");
      return { action: raw.action, approve };
    }
    case "next":
    case "rematch":
      return { action: raw.action, approve: optionalBoolean(raw.approve) };
    case "start":
    case "request-close":
    case "leave":
      return { action: raw.action };
    default:
      throw new UserError("无法识别的房间操作");
  }
}

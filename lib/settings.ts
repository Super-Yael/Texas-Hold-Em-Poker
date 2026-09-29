import { UserError } from "./errors";
export type RoomSettings = {
  maxPlayers: number;
  deckCount: number;
  smallBlind: number;
  bigBlind: number;
  startingStack: number;
  ante: number;
  blindIncreaseEvery: number;
  fourOfAKindMultiplier: number;
  straightMultiplier: number;
  jokersEnabled: boolean;
  jokerMultiplier: number;
};

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  maxPlayers: 6,
  deckCount: 1,
  smallBlind: 25,
  bigBlind: 50,
  startingStack: 1000,
  ante: 0,
  blindIncreaseEvery: 0,
  fourOfAKindMultiplier: 1,
  straightMultiplier: 1,
  jokersEnabled: false,
  jokerMultiplier: 2,
};

function wholeNumber(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new UserError(`${name}须为 ${min} 到 ${max} 的整数`);
  }
  return value;
}

export function validateRoomSettings(value: unknown): RoomSettings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new UserError("房间设置格式无效");
  const raw = value as Record<string, unknown>;
  if (typeof raw.jokersEnabled !== "boolean") throw new UserError("大小王设置格式无效");
  const settings: RoomSettings = {
    maxPlayers: wholeNumber(raw.maxPlayers, "人数上限", 2, 6),
    deckCount: wholeNumber(raw.deckCount, "牌的副数", 1, 4),
    smallBlind: wholeNumber(raw.smallBlind, "小盲注", 1, 500_000),
    bigBlind: wholeNumber(raw.bigBlind, "大盲注", 2, 1_000_000),
    startingStack: wholeNumber(raw.startingStack, "初始筹码", 20, 10_000_000),
    ante: wholeNumber(raw.ante, "前注", 0, 1_000_000),
    blindIncreaseEvery: wholeNumber(raw.blindIncreaseEvery, "盲注升级间隔", 0, 100),
    fourOfAKindMultiplier: wholeNumber(raw.fourOfAKindMultiplier, "四条倍数", 1, 5),
    straightMultiplier: wholeNumber(raw.straightMultiplier, "顺子倍数", 1, 5),
    jokersEnabled: raw.jokersEnabled === true,
    jokerMultiplier: wholeNumber(raw.jokerMultiplier, "王牌倍数", 2, 5),
  };
  if (settings.bigBlind <= settings.smallBlind) throw new UserError("大盲注必须高于小盲注");
  if (settings.startingStack < settings.bigBlind * 10)
    throw new UserError("初始筹码至少为大盲注的 10 倍");
  if (settings.ante > settings.bigBlind) throw new UserError("前注不能高于大盲注");
  return settings;
}

export function readRoomSettings(json: string | null | undefined): RoomSettings {
  if (!json) return { ...DEFAULT_ROOM_SETTINGS };
  const stored = JSON.parse(json) as unknown;
  if (!stored || typeof stored !== "object" || Array.isArray(stored))
    throw new UserError("房间设置格式无效");
  return validateRoomSettings({ ...DEFAULT_ROOM_SETTINGS, ...stored });
}

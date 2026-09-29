import { UserError } from "../errors";
import { parseRoomAction } from "../room-command";
import { integer, object, optionalBoolean, text } from "../validation";
import type { ClientMessage, Signal } from "./protocol";

function parseSignal(value: unknown): Signal {
  const raw = object(value);
  if (!!raw.description === !!raw.candidate) throw new UserError("连接信令格式无效");
  if (raw.description) {
    const description = object(raw.description);
    if (description.type !== "offer" && description.type !== "answer")
      throw new UserError("连接信令类型无效");
    return {
      description: { type: description.type, sdp: text(description.sdp, "连接信息", 24_000) },
    };
  }
  const candidate = object(raw.candidate);
  return {
    candidate: {
      candidate: text(candidate.candidate, "网络候选", 2000),
      sdpMid: candidate.sdpMid == null ? null : text(candidate.sdpMid, "媒体标识", 80),
      sdpMLineIndex:
        candidate.sdpMLineIndex == null
          ? null
          : integer(candidate.sdpMLineIndex, "媒体索引", 0, 64),
      ...(candidate.usernameFragment == null
        ? {}
        : { usernameFragment: text(candidate.usernameFragment, "连接标识", 256) }),
    },
  };
}

export function parseClientMessage(value: unknown): ClientMessage {
  const raw = object(value);
  switch (raw.type) {
    case "ping":
      return { type: raw.type };
    case "join":
      return {
        type: raw.type,
        roomId: text(raw.roomId, "房间"),
        protocol: integer(raw.protocol, "协议版本", 1, 100),
      };
    case "signal":
      return { type: raw.type, to: text(raw.to, "连接"), signal: parseSignal(raw.signal) };
    case "link": {
      const ready = optionalBoolean(raw.ready);
      if (ready === undefined) throw new UserError("连接状态无效");
      return { type: raw.type, to: text(raw.to, "连接"), ready };
    }
    case "received":
      return { type: raw.type, revision: integer(raw.revision, "状态版本", 1) };
    case "relay-failed": {
      if (!Array.isArray(raw.targets) || raw.targets.length > 36)
        throw new UserError("转发目标无效");
      return {
        type: raw.type,
        revision: integer(raw.revision, "状态版本", 1),
        targets: raw.targets.map((id) => text(id, "连接")),
      };
    }
    case "action":
      return {
        type: raw.type,
        id: text(raw.id, "操作编号"),
        epoch: text(raw.epoch, "服务实例"),
        revision: integer(raw.revision, "状态版本", 1),
        body: parseRoomAction(raw.body),
      };
    default:
      throw new UserError("无法识别的消息类型");
  }
}

import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { isAllowedOrigin } from "../request-security";
import { onRoomChanged } from "../events";
import { publicError, UserError } from "../errors";
import { parseClientMessage } from "./validation";
import { currentUser } from "@/lib/auth";
import { getDb } from "@/lib/database";
import { executeRoomAction } from "@/lib/room-actions";
import { closeExpiredRooms, isRoomMember, roomView } from "@/lib/rooms";
import {
  PROTOCOL_VERSION,
  REALTIME_PATH,
  splitView,
  type ClientMessage,
  type ServerMessage,
  type SignedState,
  type PersonalView,
} from "./protocol";

type Connection = {
  id: string;
  userId: string;
  socket: WebSocket;
  roomId?: string;
  alive: boolean;
  links: Set<string>;
  pending?: { revision: number; via: string; timer: NodeJS.Timeout };
  windowStart: number;
  messages: number;
  actions: number;
  invalidMessages: number;
  joinTimer?: NodeJS.Timeout;
};
type RoomChannel = { revision: number; state?: SignedState; personals: Map<string, PersonalView> };

export function requestUser(request: IncomingMessage) {
  return currentUser(
    new Request("http://localhost", { headers: { cookie: request.headers.cookie ?? "" } }),
    false,
  );
}

export function attachRealtime(server: Server) {
  const epoch = randomUUID();
  let revisionSequence = 0;
  const rosters = new Map<string, string>();
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKey = keys.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const iceServers: RTCIceServer[] = JSON.parse(
    process.env.POKER_ICE_SERVERS ?? '[{"urls":"stun:stun.cloudflare.com:3478"}]',
  );
  const connections = new Map<string, Connection>();
  const rooms = new Map<string, RoomChannel>();
  const results = new Map<
    string,
    { fingerprint: string; message: Extract<ServerMessage, { type: "result" }> }
  >();
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 32 * 1024,
    perMessageDeflate: false,
  });

  function send(client: Connection, message: ServerMessage) {
    if (client.socket.readyState !== WebSocket.OPEN) return;
    if (client.socket.bufferedAmount > 512 * 1024) {
      client.socket.close(1013, "Slow connection");
      return;
    }
    client.socket.send(JSON.stringify(message));
  }
  function members(roomId: string) {
    return [...connections.values()].filter(
      (client) => client.roomId === roomId && client.socket.readyState === WebSocket.OPEN,
    );
  }
  function clearPending(client: Connection) {
    if (client.pending) clearTimeout(client.pending.timer);
    client.pending = undefined;
  }
  function detach(client: Connection) {
    clearPending(client);
    client.roomId = undefined;
    client.links.clear();
    for (const other of connections.values()) other.links.delete(client.id);
  }
  function updatePeers(roomId: string) {
    const peers = members(roomId);
    const roster = peers.map((client) => client.id).join(",");
    if (rosters.get(roomId) === roster) return;
    rosters.set(roomId, roster);
    for (const client of peers)
      send(client, {
        type: "peers",
        peers: peers.filter((peer) => peer !== client).map(({ id, userId }) => ({ id, userId })),
      });
    if (!peers.length) {
      rooms.delete(roomId);
      rosters.delete(roomId);
    }
  }
  function fallback(client: Connection, revision: number) {
    const state = client.roomId && rooms.get(client.roomId)?.state;
    if (state && client.pending?.revision === revision) {
      clearPending(client);
      send(client, state);
    }
  }

  // One signed public snapshot goes to a player, then travels over DataChannels.
  // Private cards and permissions go directly to their owner over authenticated WS.
  function publish(roomId: string, preferred?: Connection, direct = false) {
    const active: Connection[] = [];
    for (const client of members(roomId)) {
      if (!isRoomMember(roomId, client.userId)) {
        send(client, { type: "room-gone" });
        detach(client);
      } else active.push(client);
    }
    if (!active.length) {
      rooms.delete(roomId);
      return;
    }
    const channel = rooms.get(roomId) ?? {
      revision: 0,
      personals: new Map<string, PersonalView>(),
    };
    const views = new Map(
      [...new Set(active.map((client) => client.userId))].map((userId) => [
        userId,
        roomView(roomId, userId),
      ]),
    );
    const revision = ++revisionSequence;
    channel.revision = revision;
    channel.personals.clear();
    const shared = splitView(views.get(active[0].userId)!, active[0].userId).shared;
    const payload = JSON.stringify({ epoch, roomId, revision, view: shared });
    const state: SignedState = {
      type: "state",
      payload,
      signature: sign("sha256", Buffer.from(payload), {
        key: keys.privateKey,
        dsaEncoding: "ieee-p1363",
      }).toString("base64"),
    };
    channel.state = state;
    rooms.set(roomId, channel);
    const relay =
      preferred && active.includes(preferred)
        ? preferred
        : [...active].sort((a, b) => b.links.size - a.links.size)[0];
    const targets: string[] = [];
    for (const client of active) {
      clearPending(client);
      const personal = splitView(views.get(client.userId)!, client.userId).personal;
      channel.personals.set(client.userId, personal);
      send(client, { type: "private", epoch, revision, personal });
      if (!direct && client !== relay && relay.links.has(client.id) && client.links.has(relay.id)) {
        targets.push(client.id);
        client.pending = {
          revision,
          via: relay.id,
          timer: setTimeout(() => fallback(client, revision), 1000),
        };
      } else if (client !== relay) send(client, state);
    }
    send(relay, targets.length ? { type: "relay", state, targets } : state);
    updatePeers(roomId);
  }

  function resend(client: Connection) {
    const channel = client.roomId && rooms.get(client.roomId);
    if (!channel || !channel.state) return;
    const personal = channel.personals.get(client.userId);
    if (!personal) return;
    clearPending(client);
    send(client, { type: "private", epoch, revision: channel.revision, personal });
    send(client, channel.state);
  }

  const unsubscribe = onRoomChanged(({ roomId, actorId }) => {
    try {
      publish(
        roomId,
        members(roomId).find((client) => client.userId === actorId),
      );
    } catch (error) {
      rooms.delete(roomId);
      for (const client of members(roomId)) client.socket.close(1011, "Snapshot unavailable");
      console.error("Unable to publish room snapshot", error);
    }
  });

  function handle(client: Connection, message: ClientMessage) {
    if (message.type === "ping") {
      send(client, { type: "pong" });
      return;
    }
    if (message.type === "join") {
      if (message.protocol !== PROTOCOL_VERSION) throw new UserError("页面已更新，请刷新后继续");
      if (typeof message.roomId !== "string" || !isRoomMember(message.roomId, client.userId)) {
        send(client, { type: "room-gone" });
        return;
      }
      if (client.roomId) throw new UserError("连接已经加入房间");
      client.roomId = message.roomId;
      clearTimeout(client.joinTimer);
      publish(message.roomId, client, true);
      return;
    }
    const roomId = client.roomId;
    if (!roomId || !isRoomMember(roomId, client.userId)) {
      send(client, { type: "room-gone" });
      detach(client);
      return;
    }
    if (message.type === "signal" || message.type === "link") {
      const target = connections.get(message.to);
      if (
        !target ||
        target === client ||
        target.roomId !== roomId ||
        !isRoomMember(roomId, target.userId)
      )
        return;
      if (message.type === "signal")
        send(target, { type: "signal", from: client.id, signal: message.signal });
      else if (message.ready === true) client.links.add(target.id);
      else client.links.delete(target.id);
      return;
    }
    if (message.type === "received") {
      if (client.pending?.revision === message.revision) clearPending(client);
      return;
    }
    if (message.type === "relay-failed") {
      if (!Array.isArray(message.targets)) return;
      for (const id of message.targets.slice(0, 24)) {
        const target = connections.get(id);
        if (target?.roomId === roomId && target.pending?.via === client.id)
          fallback(target, message.revision);
      }
      return;
    }
    if (message.type !== "action") return;
    if (++client.actions > 30) throw new UserError("操作过于频繁，请稍后再试", 429);
    const key = `${client.userId}:${message.id}`;
    const fingerprint = JSON.stringify([roomId, message.body]);
    const previous = results.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new UserError("操作编号重复");
      send(client, previous.message);
      return;
    }
    let result: Extract<ServerMessage, { type: "result" }>;
    try {
      if (message.epoch !== epoch || message.revision !== rooms.get(roomId)?.revision) {
        resend(client);
        throw new UserError("牌局已更新，请根据最新状态重新操作");
      }
      executeRoomAction(roomId, client.userId, message.body);
      result = { type: "result", id: message.id, ok: true };
    } catch (error) {
      result = {
        type: "result",
        id: message.id,
        ok: false,
        error: publicError(error, "操作失败").message,
      };
    }
    results.set(key, { fingerprint, message: result });
    if (results.size > 2000) results.delete(results.keys().next().value!);
    send(client, result);
  }

  server.prependListener("upgrade", (request, socket, head) => {
    try {
      if (new URL(request.url ?? "/", "http://localhost").pathname !== REALTIME_PATH) return;
      if (!isAllowedOrigin(request.headers.origin, request.headers.host)) {
        socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
        return;
      }
      const user = requestUser(request);
      if (!user) {
        socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
        return;
      }
      if (
        connections.size >= 256 ||
        [...connections.values()].filter((client) => client.userId === user.id).length >= 6
      ) {
        socket.end("HTTP/1.1 429 Too Many Requests\r\n\r\n");
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        const client: Connection = {
          id: randomUUID(),
          userId: user.id,
          socket: ws,
          alive: true,
          links: new Set(),
          windowStart: Date.now(),
          messages: 0,
          actions: 0,
          invalidMessages: 0,
        };
        client.joinTimer = setTimeout(() => ws.close(1008, "Join timeout"), 10_000);
        connections.set(client.id, client);
        send(client, {
          type: "welcome",
          protocol: PROTOCOL_VERSION,
          id: client.id,
          epoch,
          publicKey,
          iceServers,
        });
        ws.on("pong", () => {
          client.alive = true;
        });
        ws.on("error", () => {});
        ws.on("message", (data, binary) => {
          try {
            if (Date.now() - client.windowStart > 10_000) {
              client.windowStart = Date.now();
              client.messages = 0;
              client.actions = 0;
            }
            if (++client.messages > 300 || binary) {
              ws.close(1008, "Invalid traffic");
              return;
            }
            let raw: unknown;
            try {
              raw = JSON.parse(data.toString());
            } catch {
              throw new UserError("JSON 格式无效");
            }
            const message = parseClientMessage(raw);
            handle(client, message);
          } catch (error) {
            send(client, { type: "error", error: publicError(error, "消息处理失败").message });
            if (++client.invalidMessages >= 10) ws.close(1008, "Invalid messages");
          }
        });
        ws.on("close", () => {
          clearTimeout(client.joinTimer);
          const roomId = client.roomId;
          detach(client);
          connections.delete(client.id);
          if (roomId) updatePeers(roomId);
        });
      });
    } catch {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    }
  });

  const heartbeat = setInterval(() => {
    const touch = getDb().prepare("UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?");
    const touched = new Set<string>();
    for (const client of connections.values()) {
      if (!client.alive) {
        client.socket.terminate();
        continue;
      }
      client.alive = false;
      client.socket.ping();
      if (!touched.has(client.userId)) {
        touch.run(client.userId);
        touched.add(client.userId);
      }
    }
  }, 20_000);
  const maintenance = setInterval(() => {
    try {
      closeExpiredRooms();
    } catch (error) {
      console.error("Room maintenance failed", error);
    }
  }, 15_000);
  return {
    publish,
    close() {
      unsubscribe();
      clearInterval(heartbeat);
      clearInterval(maintenance);
      for (const client of connections.values()) {
        clearPending(client);
        clearTimeout(client.joinTimer);
        client.socket.terminate();
      }
      wss.close();
    },
  };
}

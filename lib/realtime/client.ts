import { PeerMesh } from "./peer-mesh";
import type { RoomView } from "@/lib/table-types";
import type { RoomAction } from "@/lib/room-command";
import {
  mergeView,
  PROTOCOL_VERSION,
  REALTIME_PATH,
  type ClientMessage,
  type PersonalView,
  type PublicState,
  type ServerMessage,
  type SignedState,
} from "./protocol";

type PendingAction = {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
const fromBase64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

export class TableRealtime {
  private socket?: WebSocket;
  private stopped = false;
  private generation = 0;
  private reconnect?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private attempts = 0;
  private lastMessage = 0;
  private epoch = "";
  private key?: CryptoKey;
  private revision = 0;
  private latestPrivate = 0;
  private ready = false;
  private mesh?: PeerMesh;
  private publics = new Map<number, PublicState>();
  private personals = new Map<number, PersonalView>();
  private pending = new Map<string, PendingAction>();

  constructor(
    private roomId: string,
    private onView: (view: RoomView | null) => void,
    private onStatus: (message: string) => void,
  ) {}

  start() {
    this.connect();
    document.addEventListener("visibilitychange", this.onVisible);
    window.addEventListener("online", this.onVisible);
  }

  private onVisible = () => {
    if (document.visibilityState !== "visible" || this.stopped) return;
    if (this.socket?.readyState === WebSocket.OPEN) {
      if (Date.now() - this.lastMessage > 45_000) this.socket.close();
      else this.send({ type: "ping" });
    } else if (!this.socket || this.socket.readyState === WebSocket.CLOSED) {
      clearTimeout(this.reconnect);
      this.connect();
    }
  };

  private send(message: ClientMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private connect() {
    if (this.stopped) return;
    const generation = ++this.generation;
    this.ready = false;
    this.key = undefined;
    this.revision = 0;
    this.latestPrivate = 0;
    this.publics.clear();
    this.personals.clear();
    this.mesh?.close();
    this.onStatus("正在连接牌桌…");
    const socket = new WebSocket(
      `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${REALTIME_PATH}`,
    );
    this.socket = socket;
    let queue = Promise.resolve();
    socket.onmessage = (event) => {
      this.lastMessage = Date.now();
      queue = queue
        .then(async () => {
          if (this.stopped || generation !== this.generation) return;
          await this.handle(JSON.parse(event.data) as ServerMessage, generation);
        })
        .catch(() => {
          if (!this.stopped && generation === this.generation)
            this.onStatus("同步暂时失败，正在恢复连接…");
          socket.close();
        });
    };
    socket.onopen = () => {
      this.lastMessage = Date.now();
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastMessage > 45_000) socket.close();
        else this.send({ type: "ping" });
      }, 20_000);
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (generation !== this.generation) return;
      clearInterval(this.heartbeat);
      this.ready = false;
      this.mesh?.close();
      this.rejectPending("连接中断；重连后请确认最新操作结果");
      if (this.stopped) return;
      ++this.generation;
      this.onStatus("连接中断，正在重新连接牌桌…");
      const delay = Math.min(15_000, 500 * 2 ** this.attempts++) + Math.random() * 300;
      this.reconnect = setTimeout(() => this.connect(), delay);
    };
  }

  private async handle(message: ServerMessage, generation: number) {
    if (message.type === "welcome") {
      if (message.protocol !== PROTOCOL_VERSION) throw new Error("Protocol mismatch");
      this.epoch = message.epoch;
      this.mesh = new PeerMesh(
        message.id,
        message.iceServers,
        (value) => this.send(value),
        (state) => this.receiveState(state, generation),
      );
      this.key = await crypto.subtle.importKey(
        "spki",
        fromBase64(message.publicKey),
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      );
      if (generation === this.generation && !this.stopped)
        this.send({ type: "join", roomId: this.roomId, protocol: PROTOCOL_VERSION });
    } else if (message.type === "private") {
      if (message.epoch !== this.epoch || message.revision <= this.revision) return;
      this.latestPrivate = Math.max(this.latestPrivate, message.revision);
      this.personals.set(message.revision, message.personal);
      if (this.personals.size > 8) this.personals.delete(this.personals.keys().next().value!);
      this.apply(message.revision);
    } else if (message.type === "state") {
      await this.receiveState(message, generation);
    } else if (message.type === "relay") {
      const revision = await this.receiveState(message.state, generation);
      if (!revision || this.stopped || generation !== this.generation) return;
      const failed = this.mesh?.relay(message.state, message.targets) ?? message.targets;
      if (failed.length) this.send({ type: "relay-failed", revision, targets: failed });
    } else if (message.type === "peers") {
      this.mesh?.update(message.peers);
    } else if (message.type === "signal") {
      this.mesh?.signal(message.from, message.signal);
    } else if (message.type === "result") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.ok) pending.resolve();
      else pending.reject(new Error(message.error || "操作失败"));
    } else if (message.type === "room-gone") {
      this.ready = false;
      this.onStatus("");
      this.onView(null);
    } else if (message.type === "error") {
      this.rejectPending(message.error);
      this.onStatus(message.error);
    }
  }

  private async receiveState(message: SignedState, generation: number) {
    if (
      !this.key ||
      typeof message.signature !== "string" ||
      message.signature.length > 128 ||
      typeof message.payload !== "string" ||
      message.payload.length > 256 * 1024
    )
      return;
    const key = this.key;
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      fromBase64(message.signature),
      new TextEncoder().encode(message.payload),
    );
    if (!valid || this.stopped || generation !== this.generation) return;
    const state = JSON.parse(message.payload) as PublicState;
    if (
      state.epoch !== this.epoch ||
      state.roomId !== this.roomId ||
      state.revision <= this.revision
    )
      return;
    this.publics.set(state.revision, state);
    if (this.publics.size > 8) this.publics.delete(this.publics.keys().next().value!);
    this.apply(state.revision);
    return state.revision;
  }

  private apply(revision: number) {
    const state = this.publics.get(revision);
    const personal = this.personals.get(revision);
    if (!state || !personal || revision < this.latestPrivate || revision <= this.revision) return;
    this.revision = revision;
    this.ready = true;
    this.attempts = 0;
    this.onView(mergeView(state.view, personal));
    this.onStatus("");
    this.send({ type: "received", revision });
    for (const key of this.publics.keys()) if (key <= revision) this.publics.delete(key);
    for (const key of this.personals.keys()) if (key <= revision) this.personals.delete(key);
  }

  private rejectPending(message: string) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }

  action(body: RoomAction): Promise<void> {
    if (
      !this.ready ||
      this.latestPrivate > this.revision ||
      this.socket?.readyState !== WebSocket.OPEN
    )
      return Promise.reject(new Error("正在同步牌局，请稍后再操作"));
    if (this.pending.size) return Promise.reject(new Error("上一条操作正在确认中"));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("未收到操作确认，正在重连；请先确认最新牌局，避免重复操作"));
        this.socket?.close();
      }, 10_000);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ type: "action", id, epoch: this.epoch, revision: this.revision, body });
    });
  }

  stop() {
    this.stopped = true;
    this.ready = false;
    ++this.generation;
    clearTimeout(this.reconnect);
    clearInterval(this.heartbeat);
    document.removeEventListener("visibilitychange", this.onVisible);
    window.removeEventListener("online", this.onVisible);
    this.mesh?.close();
    this.rejectPending("牌桌连接已关闭");
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
    }
  }
}

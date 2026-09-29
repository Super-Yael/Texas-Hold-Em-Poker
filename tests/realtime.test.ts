import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { WebSocket } from "ws";
import { getDb } from "../lib/database";
import { attachRealtime } from "../lib/realtime/server";
import { mergeView, type PublicState, type ServerMessage, type SignedState } from "../lib/realtime/protocol";

test("realtime validates actions, isolates cards, relays signed state, recovers and rejects stale actions", async () => {
  const directory = mkdtempSync(join(tmpdir(), "poker-realtime-"));
  process.env.POKER_DB_PATH = join(directory, "test.sqlite");
  const db = getDb();
  const server = createServer();
  const realtime = attachRealtime(server);
  const clients: WebSocket[] = [];
  try {
    for (const id of ["a", "b", "outsider"]) db.prepare("INSERT INTO users (id,nickname) VALUES (?,?)").run(id, id);
    db.prepare("INSERT INTO rooms (id,host_id,status) VALUES ('TABLE','a','lobby')").run();
    for (const [seat, id] of ["a", "b"].entries()) db.prepare("INSERT INTO room_members (room_id,user_id,seat) VALUES ('TABLE',?,?)").run(id, seat);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    const origin = `http://127.0.0.1:${address.port}`;
    const url = `ws://127.0.0.1:${address.port}/realtime`;
    const connect = async (userId: string) => {
      const socket = new WebSocket(url, { headers: { cookie: `poker_user=${userId}`, origin } });
      clients.push(socket);
      const messages: ServerMessage[] = [];
      socket.on("message", (data) => messages.push(JSON.parse(data.toString())));
      const wait = async <T extends ServerMessage["type"]>(type: T, after = 0) => {
        const until = Date.now() + 4000;
        while (Date.now() < until) {
          const item = messages.slice(after).find((message) => message.type === type);
          if (item) return item as Extract<ServerMessage, { type: T }>;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error(`Missing ${type}`);
      };
      const welcome = await wait("welcome");
      const send = (message: object) => socket.send(JSON.stringify(message));
      send({ type: "join", roomId: "TABLE", protocol: 1 });
      return { socket, messages, wait, welcome, send };
    };
    const a = await connect("a");
    const b = await connect("b");
    await b.wait("state");
    const outsider = await connect("outsider");
    await outsider.wait("room-gone");
    assert.equal(outsider.messages.some((item) => item.type === "state" || item.type === "private"), false);
    const decode = (state: SignedState): PublicState => {
      const key = createPublicKey({ key: Buffer.from(a.welcome.publicKey, "base64"), type: "spki", format: "der" });
      assert(verify("sha256", Buffer.from(state.payload), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(state.signature, "base64")));
      assert(!verify("sha256", Buffer.from(state.payload + " "), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(state.signature, "base64")));
      return JSON.parse(state.payload);
    };
    const latest = () => decode([...a.messages].reverse().flatMap((item) => item.type === "state" ? [item] : item.type === "relay" ? [item.state] : [])[0]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    a.send({ type: "link", to: b.welcome.id, ready: true });
    b.send({ type: "link", to: a.welcome.id, ready: true });
    const beforeStart = a.messages.length;
    const bBeforeStart = b.messages.length;
    const start = { type: "action", id: "start-once", epoch: a.welcome.epoch, revision: latest().revision, body: { action: "start" } };
    await new Promise((resolve) => setTimeout(resolve, 20));
    a.send(start);
    assert.equal((await a.wait("result", beforeStart)).ok, true);
    const relay = await a.wait("relay", beforeStart);
    const shared = decode(relay.state);
    assert.deepEqual(relay.targets, [b.welcome.id]);
    assert(shared.view.game!.players.every((player) => player.hole.length === 0 && !player.handScore));
    assert.equal("deck" in shared.view.game!, false);
    const aPrivate = await a.wait("private", beforeStart);
    const bPrivate = await b.wait("private", bBeforeStart);
    const aView = mergeView(shared.view, aPrivate.personal);
    const bView = mergeView(shared.view, bPrivate.personal);
    assert.equal(aView.game!.players.find((player) => player.id === "a")!.hole.length, 2);
    assert.equal(aView.game!.players.find((player) => player.id === "b")!.hole.length, 0);
    assert.equal(bView.game!.players.find((player) => player.id === "b")!.hole.length, 2);
    assert.equal(bView.game!.players.find((player) => player.id === "a")!.hole.length, 0);
    // Simulate a peer that fails to relay: the same signed state must arrive via WS.
    const recovered = await b.wait("state", bBeforeStart);
    assert.equal(recovered.payload, relay.state.payload);
    const stored = db.prepare("SELECT game_json FROM rooms WHERE id='TABLE'").get() as { game_json: string };
    const repeatAt = a.messages.length;
    a.send(start);
    assert.equal((await a.wait("result", repeatAt)).ok, true);
    assert.deepEqual(db.prepare("SELECT game_json FROM rooms WHERE id='TABLE'").get(), stored);
    const staleAt = a.messages.length;
    a.send({ ...start, id: "stale-action", body: { action: "act", kind: "fold" } });
    assert.equal((await a.wait("result", staleAt)).ok, false);
    assert.deepEqual(db.prepare("SELECT game_json FROM rooms WHERE id='TABLE'").get(), stored);
    const bReconnect = await connect("b");
    const recoveredView = decode(await bReconnect.wait("state"));
    const recoveredPrivate = await bReconnect.wait("private");
    assert.deepEqual(mergeView(recoveredView.view, recoveredPrivate.personal).game!.players.find((player) => player.id === "b")!.hole, bView.game!.players.find((player) => player.id === "b")!.hole);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const actor = latest().view.game!.currentPlayerId === "a" ? a : b;
    const actAt = actor.messages.length;
    actor.send({ type: "action", id: "fold", epoch: a.welcome.epoch, revision: latest().revision, body: { action: "act", kind: "fold" } });
    assert.equal((await actor.wait("result", actAt)).ok, true);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM poker_hands").get() as { n: number }).n, 1);
    for (const member of [a, b]) {
      const at = member.messages.length;
      member.send({ type: "action", id: `close-${member.welcome.id}`, epoch: a.welcome.epoch, revision: latest().revision, body: { action: member === a ? "request-close" : "close-vote", approve: true } });
      assert.equal((await member.wait("result", at)).ok, true);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    await bReconnect.wait("room-gone");
    assert.equal(db.prepare("SELECT id FROM rooms WHERE id='TABLE'").get(), undefined);
  } finally {
    for (const client of clients) client.terminate();
    realtime.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
    delete (globalThis as typeof globalThis & { pokerDb?: unknown }).pokerDb;
    rmSync(directory, { recursive: true, force: true });
  }
});

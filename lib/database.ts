import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

type Db = InstanceType<typeof Database>;
const globalForDb = globalThis as typeof globalThis & { pokerDb?: Db };
const schemaVersion = 3;

export function getDb() {
  if (globalForDb.pokerDb) return globalForDb.pokerDb;
  const filename = process.env.POKER_DB_PATH ?? path.join(process.cwd(), ".data", "poker.sqlite");
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  const currentVersion = db.pragma("user_version", { simple: true }) as number;
  if (currentVersion > schemaVersion) {
    db.close();
    throw new Error(`数据库版本 ${currentVersion} 高于当前程序支持的版本 ${schemaVersion}`);
  }
  if (currentVersion < 1)
    db.transaction(() => {
      db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      nickname TEXT NOT NULL COLLATE NOCASE UNIQUE,
      avatar TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      host_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('lobby', 'playing', 'closed')),
      game_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS room_members (
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      seat INTEGER NOT NULL,
      joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (room_id, user_id),
      UNIQUE (room_id, seat)
    );
    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (room_id, to_id)
    );
    CREATE TABLE IF NOT EXISTS poker_hands (
      game_id TEXT NOT NULL,
      hand_no INTEGER NOT NULL,
      room_id TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (game_id, hand_no)
    );
    CREATE INDEX IF NOT EXISTS invitations_to_status ON invitations(to_id, status);
    CREATE INDEX IF NOT EXISTS room_members_user ON room_members(user_id);
    `);
      db.pragma("user_version = 1");
    }).immediate();
  if (currentVersion < 2)
    db.transaction(() => {
      db.exec("ALTER TABLE rooms ADD COLUMN settings_json TEXT");
      db.pragma("user_version = 2");
    }).immediate();
  if (currentVersion < 3)
    db.transaction(() => {
      db.exec("ALTER TABLE rooms ADD COLUMN close_requested_at INTEGER");
      db.exec("CREATE INDEX rooms_close_deadline ON rooms(status, close_requested_at)");
      const rooms = db
        .prepare(
          "SELECT id, game_json FROM rooms WHERE status = 'playing' AND game_json IS NOT NULL",
        )
        .all() as Array<{ id: string; game_json: string }>;
      const update = db.prepare("UPDATE rooms SET close_requested_at = ? WHERE id = ?");
      for (const room of rooms) {
        const request = (
          JSON.parse(room.game_json) as { closeRequest?: { createdAt?: number } | null }
        ).closeRequest;
        if (request && Number.isSafeInteger(request.createdAt) && request.createdAt! > 0)
          update.run(request.createdAt, room.id);
      }
      db.pragma("user_version = 3");
    }).immediate();
  globalForDb.pokerDb = db;
  return db;
}

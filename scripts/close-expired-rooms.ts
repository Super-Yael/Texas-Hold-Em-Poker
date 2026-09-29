import fs from "node:fs";
import path from "node:path";
import { getDb } from "../lib/database";
import { closeExpiredRooms } from "../lib/rooms";

const databasePath = path.resolve(process.cwd(), process.env.POKER_DB_PATH || ".data/poker.sqlite");
if (!fs.existsSync(databasePath)) throw new Error(`数据库不存在：${databasePath}`);

try {
  console.log(`自动关闭 ${closeExpiredRooms()} 个超时房间`);
} finally {
  getDb().close();
}

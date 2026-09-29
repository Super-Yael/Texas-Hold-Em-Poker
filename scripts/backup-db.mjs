import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const databasePath = path.resolve(process.cwd(), process.env.POKER_DB_PATH || ".data/poker.sqlite");
const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
const backupPath = path.resolve(
  process.cwd(),
  process.argv[2] || path.join(path.dirname(databasePath), "backups", `poker-${timestamp}.sqlite`),
);

if (backupPath === databasePath) throw new Error("备份路径不能与数据库路径相同");
if (fs.existsSync(backupPath)) throw new Error(`备份目标已存在：${backupPath}`);
fs.mkdirSync(path.dirname(backupPath), { recursive: true });
const db = new Database(databasePath, { readonly: true, fileMustExist: true });
try {
  await db.backup(backupPath);
  fs.chmodSync(backupPath, 0o600);
  const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
  try {
    if (backup.pragma("quick_check", { simple: true }) !== "ok") {
      throw new Error("备份完整性检查失败");
    }
  } finally {
    backup.close();
  }
  console.log(`数据库备份已保存：${backupPath}`);
} catch (error) {
  fs.rmSync(backupPath, { force: true });
  throw error;
} finally {
  db.close();
}

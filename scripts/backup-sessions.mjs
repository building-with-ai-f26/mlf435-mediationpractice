// Exports the whole sessions table to backups/sessions-YYYY-MM-DD.json.
// Usage: node scripts/backup-sessions.mjs   (reads DATABASE_URL from the environment, then .env)
// Read only: runs one SELECT. The connection string is never printed.
// The file holds real transcripts, so backups/ is git-ignored.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readSetting } from "../auth.mjs";

const SELECT_ALL = "select * from sessions order by created_at, id";

export function backupFileName(now = new Date()) {
  return `sessions-${now.toISOString().slice(0, 10)}.json`;
}

// db must have: query(text) -> rows[]. Returns the path written.
export async function backupSessions({ db, dir, now = new Date() }) {
  const rows = await db.query(SELECT_ALL);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, backupFileName(now));
  fs.writeFileSync(file, JSON.stringify({ exportedAt: now.toISOString(), count: rows.length, sessions: rows }, null, 2), { mode: 0o600 });
  return { file, count: rows.length };
}

async function main() {
  const url = readSetting("DATABASE_URL");
  if (!url || /placeholder|your-|user:password@/i.test(url)) {
    console.error("ERROR: DATABASE_URL not found in the environment or .env");
    process.exit(1);
  }
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);
  const { file, count } = await backupSessions({
    db: { query: (text) => sql.query(text, []) },
    dir: path.join(process.cwd(), "backups"),
  });
  console.log(`Saved ${count} sessions to ${path.relative(process.cwd(), file)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    let msg = String((err && err.message) || err);
    const url = readSetting("DATABASE_URL");
    if (url) msg = msg.split(url).join("[redacted]");
    console.error("Backup failed:", msg);
    process.exit(1);
  });
}

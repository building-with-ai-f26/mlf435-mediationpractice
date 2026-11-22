// Applies the numbered files in migrations/ that schema_migrations does not list yet.
// Usage: node scripts/migrate.mjs   (reads DATABASE_URL from the environment, then .env)
// The connection string is never printed.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CREATE_TABLE =
  "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())";

// Split on a semicolon at the end of a line. Blank pieces are dropped.
export function splitStatements(sql) {
  return sql
    .split(/;[ \t]*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Names of the .sql files in a folder, in name order.
export function listMigrationFiles(dir, fsImpl = fs) {
  return fsImpl.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
}

// db must have: query(text, params) -> rows[], and transaction([{text, params}]) -> runs all in one transaction.
// Returns the names applied, in order.
export async function runMigrations({ db, files, readFile, log = console.log }) {
  await db.query(CREATE_TABLE);
  const rows = await db.query("select name from schema_migrations");
  const done = new Set(rows.map((r) => r.name));
  const applied = [];
  for (const name of [...files].sort()) {
    if (done.has(name)) continue;
    const statements = splitStatements(readFile(name)).map((text) => ({ text, params: [] }));
    statements.push({ text: "insert into schema_migrations (name) values ($1)", params: [name] });
    await db.transaction(statements);
    log(`applied ${name}`);
    applied.push(name);
  }
  return applied;
}

export function readDatabaseUrl(env = process.env, envPath = path.join(process.cwd(), ".env")) {
  let url = (env.DATABASE_URL || "").trim();
  if (!url && fs.existsSync(envPath)) {
    const m = fs.readFileSync(envPath, "utf-8").match(/^DATABASE_URL=(.+)$/m);
    if (m) url = m[1].trim().replace(/^["']|["']$/g, "");
  }
  return url;
}

async function main() {
  const url = readDatabaseUrl();
  if (!url) {
    console.error("ERROR: DATABASE_URL not found in the environment or .env");
    process.exit(1);
  }
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);
  const db = {
    query: (text, params = []) => sql.query(text, params),
    transaction: (stmts) => sql.transaction(stmts.map((s) => sql.query(s.text, s.params))),
  };
  const dir = path.join(process.cwd(), "migrations");
  const files = listMigrationFiles(dir);
  const applied = await runMigrations({
    db,
    files,
    readFile: (name) => fs.readFileSync(path.join(dir, name), "utf-8"),
  });
  if (applied.length === 0) console.log("nothing to apply");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    // Print only the message, never the connection string.
    const url = readDatabaseUrl();
    let msg = String(err && err.message || err);
    if (url) msg = msg.split(url).join("[redacted]");
    console.error("Migration failed:", msg);
    process.exit(1);
  });
}

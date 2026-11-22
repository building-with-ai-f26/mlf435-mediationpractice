import { test } from "node:test";
import assert from "node:assert/strict";
import { runMigrations, splitStatements, listMigrationFiles } from "../scripts/migrate.mjs";

function stubDb(alreadyApplied = []) {
  const calls = { queries: [], transactions: [] };
  return {
    calls,
    async query(text) {
      calls.queries.push(text);
      return text.startsWith("select name") ? alreadyApplied.map((name) => ({ name })) : [];
    },
    async transaction(stmts) {
      calls.transactions.push(stmts);
    },
  };
}

const sqlFiles = {
  "0002_b.sql": "create table b (id int);\n",
  "0001_a.sql": "create table a (id int);\ncreate index a_i on a (id);\n",
};
const readFile = (n) => sqlFiles[n];

test("applies files in name order, one transaction each, with the schema_migrations row", async () => {
  const db = stubDb();
  const logs = [];
  const applied = await runMigrations({ db, files: ["0002_b.sql", "0001_a.sql"], readFile, log: (m) => logs.push(m) });
  assert.deepEqual(applied, ["0001_a.sql", "0002_b.sql"]);
  assert.deepEqual(logs, ["applied 0001_a.sql", "applied 0002_b.sql"]);
  assert.equal(db.calls.transactions.length, 2);
  const first = db.calls.transactions[0];
  assert.equal(first.length, 3);
  assert.match(first[2].text, /insert into schema_migrations/);
  assert.deepEqual(first[2].params, ["0001_a.sql"]);
});

test("skips files already recorded", async () => {
  const db = stubDb(["0001_a.sql"]);
  const applied = await runMigrations({ db, files: ["0001_a.sql", "0002_b.sql"], readFile, log() {} });
  assert.deepEqual(applied, ["0002_b.sql"]);
  assert.equal(db.calls.transactions.length, 1);
});

test("applies nothing when all are recorded", async () => {
  const db = stubDb(["0001_a.sql", "0002_b.sql"]);
  const applied = await runMigrations({ db, files: ["0001_a.sql", "0002_b.sql"], readFile, log() {} });
  assert.deepEqual(applied, []);
  assert.equal(db.calls.transactions.length, 0);
});

test("creates schema_migrations first", async () => {
  const db = stubDb();
  await runMigrations({ db, files: [], readFile, log() {} });
  assert.match(db.calls.queries[0], /create table if not exists schema_migrations/);
});

test("splits only on a semicolon at the end of a line", () => {
  assert.deepEqual(splitStatements("select 'a;b';\nselect 2;\n"), ["select 'a;b'", "select 2"]);
});

test("the real migrations folder lists in order", () => {
  const files = listMigrationFiles(new URL("../migrations", import.meta.url).pathname);
  assert.equal(files[0], "0001_sessions.sql");
  assert.deepEqual(files, [...files].sort());
});

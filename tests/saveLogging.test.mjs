// Save logging and the startup mode line. Offline, fake URLs only.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createApiRoutes } from "../apiRoutes.mjs";

const FAKE = "postgresql://u:p@h.example/db?sslmode=require&channel_binding=require";
const body = JSON.stringify({
  scenario: "noise", difficulty: "easy", createdAt: "2026-01-01T00:00:00.000Z", result: { met: 7, score: 47 },
  transcript: [{ turn: 1, role: "ra", sender: "Sam", text: "private words", at: "2026-01-01T00:00:00.000Z" }],
});
const post = (routes, headers = { authorization: "Bearer secret-token" }, text = body) => routes.handle({ method: "POST", pathname: "/api/transcript", headers, text });
function make(over = {}) {
  const logged = [];
  const routes = createApiRoutes({ verifyUser: async () => ({ id: "user-123" }), liveAiEnabled: true, log: (...a) => logged.push(a.join(" ")), ...over });
  return { routes, logged };
}
const clean = logged => logged.every(l => !/postgres(ql)?:\/\/|h\.example|secret-token|user-123|private words/i.test(l));

test("database save logs [save-ok] database mode", async () => {
  const { routes, logged } = make({ query: async (t) => (/count/.test(t) ? [{ n: 0 }] : [{ id: "x" }]) });
  assert.equal((await post(routes)).status, 200);
  assert.deepEqual(logged, ["[save-ok] database mode"]);
});

test("file save logs [save-ok] file mode, and a file error logs [save-failed]", async () => {
  const a = make({ query: null, saveFile: () => "a.json" });
  assert.equal((await post(a.routes)).status, 200);
  assert.deepEqual(a.logged, ["[save-ok] file mode"]);
  const b = make({ query: null, saveFile: () => { const e = new Error("EACCES: cannot write"); e.name = "Error"; throw e; } });
  assert.equal((await post(b.routes)).status, 500);
  assert.deepEqual(b.logged, ["[save-failed] Error: EACCES: cannot write"]);
});

test("refusals log [save-failed] with a fixed message and no user data", async () => {
  const { routes, logged } = make({ query: async () => [{ n: 99 }], userSessionsPerDay: 10 });
  assert.equal((await post(routes, {})).status, 401);
  assert.equal((await post(routes, undefined, "not json")).status, 400);
  assert.equal((await post(routes)).status, 429);
  assert.equal(logged.length, 3);
  assert.ok(logged.every(l => l.startsWith("[save-failed] ")));
  assert.ok(clean(logged), logged.join("\n"));
});

test("a database error containing the connection string and user data logs clean", async () => {
  const { routes, logged } = make({ query: async () => { const e = new Error(`bad (connection string: "${FAKE}") for user-123 secret-token`); e.name = "NeonDbError"; throw e; } });
  assert.equal((await post(routes)).status, 500);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /^\[save-failed\] NeonDbError: /);
  assert.ok(!/postgres(ql)?:\/\/|h\.example/i.test(logged[0]), logged[0]);
});

// ---- startup line: runs the real server with a fake URL and a temporary folder ----
const procs = [];
after(() => procs.forEach(p => p.kill()));
function start(extraEnv) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "startup-"));
  fs.writeFileSync(path.join(cwd, ".env"), "OPENROUTER_API_KEY=sk-or-test-key-for-tests\n");
  fs.mkdirSync(path.join(cwd, "public"));
  const env = { ...process.env, DATABASE_URL: "", PORT: String(40000 + Math.floor(Math.random() * 20000)), ...extraEnv };
  const p = spawn(process.execPath, [path.resolve("server.mjs")], { cwd, env });
  procs.push(p);
  return new Promise(resolve => {
    let out = "";
    const done = () => resolve(out);
    p.stdout.on("data", d => { out += d; if (out.includes("Server running")) done(); });
    p.stderr.on("data", d => { out += d; });
    p.on("exit", done);
    setTimeout(done, 5000);
  });
}

test("startup line: database mode with a fake URL, never printing it", async () => {
  const out = await start({ DATABASE_URL: `"${FAKE}"` });
  assert.match(out, /\[startup\] session saving: database mode/);
  assert.ok(!/postgres(ql)?:\/\/|h\.example/i.test(out), out);
});

test("startup line: file mode when DATABASE_URL is empty or the placeholder", async () => {
  assert.match(await start({}), /\[startup\] session saving: file mode/);
  assert.match(await start({ DATABASE_URL: "postgres://USER:PASSWORD@HOST/db" }), /file mode/);
});

test("startup: an unusable DATABASE_URL exits with a clear [config] message, not echoing the value", async () => {
  const out = await start({ DATABASE_URL: "psql-nothing-here" });
  assert.match(out, /\[config\] DATABASE_URL is set but does not contain a postgres/);
  assert.ok(!out.includes("psql-nothing-here"));
});

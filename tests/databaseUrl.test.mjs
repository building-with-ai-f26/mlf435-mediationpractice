// DATABASE_URL handling. Offline: only fake URLs, and neon() gets a stubbed fetch so nothing leaves the machine.
import test from "node:test";
import assert from "node:assert/strict";
import { neon, neonConfig } from "@neondatabase/serverless";
import { readSetting, normalizeDatabaseUrl } from "../auth.mjs";
import { createApiRoutes } from "../apiRoutes.mjs";

const FAKE = "postgresql://u:p@h.example/db?sslmode=require&channel_binding=require";

// neon() parses the URL only when the first query runs, so run one against a stub.
async function runQuery(url) {
  neonConfig.fetchFunction = async () => new Response(JSON.stringify({ rows: [], fields: [] }), { status: 200, headers: { "content-type": "application/json" } });
  return neon(url).query("select 1");
}

test("a valid string works, including the channel_binding form", async () => {
  assert.equal(normalizeDatabaseUrl(FAKE), FAKE);
  assert.deepEqual(await runQuery(normalizeDatabaseUrl(FAKE)), []);
});

test("values wrapped in quotes, a psql prefix, a name prefix or a newline are cleaned and then work", async () => {
  for (const wrapped of [`"${FAKE}"`, `'${FAKE}'`, `psql '${FAKE}'`, `DATABASE_URL=${FAKE}`, `${FAKE}\n`, `  ${FAKE}  `]) {
    const fromEnv = readSetting("DATABASE_URL", { DATABASE_URL: wrapped }, "/nonexistent");
    const url = normalizeDatabaseUrl(fromEnv);
    assert.equal(url, FAKE, `cleaned from ${wrapped.slice(0, 12)}`);
    assert.deepEqual(await runQuery(url), []);
  }
});

test("without cleaning, a wrapped value fails the way production did", async () => {
  await assert.rejects(runQuery(`"${FAKE}"`), /not a valid URL/);
});

test("missing, empty and placeholder values mean not set (files are used)", () => {
  for (const v of [undefined, null, "", "   ", "postgres://USER:PASSWORD@HOST/db"]) assert.equal(normalizeDatabaseUrl(v), "");
});

test("a set value with no URL gives a clear message that does not echo the value", () => {
  for (const bad of ["not-a-url", "mysql://u:secret-pw@h/db", "postgresql://", "[object Promise]"]) {
    assert.throws(() => normalizeDatabaseUrl(bad), err => {
      assert.match(err.message, /DATABASE_URL is set but does not contain a postgres/);
      assert.ok(!err.message.includes("secret-pw") && !err.message.includes("not-a-url") && !err.message.includes("mysql://"));
      return true;
    });
  }
});

test("a failed save logs [save-failed] with name and message only, never a connection string", async () => {
  const logged = [];
  const query = async () => {
    const e = new Error(`Database connection string provided to neon() is not a valid URL (connection string: "${FAKE}") and also postgres://u:p@h.example/db`);
    e.name = "NeonDbError";
    throw e;
  };
  const routes = createApiRoutes({ verifyUser: async () => ({ id: "user-1" }), query, liveAiEnabled: true, log: (...a) => logged.push(a.join(" ")) });
  const body = JSON.stringify({
    scenario: "noise", difficulty: "easy", createdAt: "2026-01-01T00:00:00.000Z", rubricVersion: 1, result: { met: 7, score: 47 }, models: { main: "m" },
    transcript: [{ turn: 1, role: "ra", sender: "Sam", text: "hello", at: "2026-01-01T00:00:00.000Z" }],
  });
  const r = await routes.handle({ method: "POST", pathname: "/api/transcript", headers: { authorization: "Bearer x" }, text: body });
  assert.equal(r.status, 500);
  assert.equal(r.body.error.message, "Could not save the session.");
  assert.equal(logged.length, 1);
  assert.match(logged[0], /^\[save-failed\] NeonDbError: /);
  assert.ok(!/postgres(ql)?:\/\//i.test(logged[0]) && !logged[0].includes("h.example"), logged[0]);
  assert.ok(!JSON.stringify(r).includes("h.example"));
});

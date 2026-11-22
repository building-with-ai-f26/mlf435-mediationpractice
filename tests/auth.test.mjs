// Offline: a stubbed fetch serves a throwaway RSA key as "Google's" certs, and a stubbed query stands in for the database.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createVerifier, GOOGLE_CERTS_URL } from "../auth.mjs";
import { createApiRoutes } from "../apiRoutes.mjs";

const CLIENT = "test-client.apps.googleusercontent.com";
const NOW = 1_800_000_000_000;
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");

function token(claims = {}, { key = privateKey, kid = "k1", alg = "RS256" } = {}) {
  const body = { iss: "https://accounts.google.com", aud: CLIENT, exp: NOW / 1000 + 600, sub: "user-1", given_name: "Sam", ...claims };
  const data = b64({ alg, kid }) + "." + b64(body);
  return data + "." + crypto.sign("RSA-SHA256", Buffer.from(data), key).toString("base64url");
}
function stubFetch() {
  const f = async url => {
    f.calls.push(url);
    return { ok: true, json: async () => ({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "k1" }] }) };
  };
  f.calls = [];
  return f;
}
const verifier = (extra = {}) => createVerifier({ clientId: CLIENT, fetchImpl: stubFetch(), now: () => NOW, ...extra });

test("verifyUser: good token gives id and first name; keys cached", async () => {
  const f = stubFetch();
  const v = createVerifier({ clientId: CLIENT, fetchImpl: f, now: () => NOW });
  assert.deepEqual(await v(token()), { id: "user-1", name: "Sam" });
  await v(token());
  assert.deepEqual(f.calls, [GOOGLE_CERTS_URL]);
});

test("verifyUser: refetches keys after an hour", async () => {
  const f = stubFetch();
  let t = NOW;
  const v = createVerifier({ clientId: CLIENT, fetchImpl: f, now: () => t });
  await v(token());
  t += 61 * 60 * 1000;
  await v(token({ exp: t / 1000 + 600 }));
  assert.equal(f.calls.length, 2);
});

test("verifyUser: rejects bad tokens", async () => {
  const v = verifier();
  assert.equal(await v(undefined), null);
  assert.equal(await v("a.b.c"), null);
  assert.equal(await v(token({}, { key: other.privateKey })), null, "wrong signature");
  assert.equal(await v(token({}, { kid: "nope" })), null, "unknown kid");
  assert.equal(await v(token({}, { alg: "none" })), null, "alg");
  assert.equal(await v(token({ exp: NOW / 1000 - 1 })), null, "expired");
  assert.equal(await v(token({ aud: "someone-else" })), null, "wrong aud");
  assert.equal(await v(token({ iss: "https://evil.example" })), null, "wrong iss");
  assert.equal(await v(token({ sub: "" })), null, "no sub");
});

test("verifyUser: accepts the bare accounts.google.com issuer", async () => {
  assert.equal((await verifier()(token({ iss: "accounts.google.com" }))).id, "user-1");
});

test("verifyUser: ALLOWED_GOOGLE_DOMAIN needs verified email and matching hd", async () => {
  const v = verifier({ allowedDomain: "example.edu" });
  assert.ok(await v(token({ email_verified: true, hd: "example.edu" })));
  assert.equal(await v(token({ email_verified: false, hd: "example.edu" })), null);
  assert.equal(await v(token({ email_verified: true, hd: "other.edu" })), null);
  assert.equal(await v(token({ email_verified: true })), null);
});

// ---- routes ----
const record = (extra = {}) => ({
  scenario: "noise", difficulty: "easy", createdAt: "2026-01-01T00:00:00.000Z", rubricVersion: 1,
  result: { met: 7, score: 47 }, models: { main: "m" },
  transcript: [{ turn: 0, role: "resident", sender: "Alex", text: "hi" }, { turn: 1, role: "ra", sender: "Sam", text: "hello", at: "2026-01-01T00:00:00.000Z" }],
  ...extra,
});
const auth = t => ({ authorization: "Bearer " + t });

function setup(over = {}) {
  const calls = [];
  const db = new Map(); // id -> { user_id }
  const query = async (text, params) => {
    calls.push({ text, params });
    if (/count\(\*\)/.test(text)) return [{ n: over.count ?? 0 }];
    if (/^\s*insert/i.test(text)) { const id = crypto.randomUUID(); db.set(id, params[0]); return [{ id }]; }
    if (/^select \*/.test(text)) return db.get(params[0]) === params[1] ? [{ id: params[0] }] : [];
    if (/^delete/.test(text)) { if (db.get(params[0]) === params[1]) { db.delete(params[0]); return [{ id: params[0] }]; } return []; }
    return [];
  };
  const routes = createApiRoutes({ verifyUser: verifier(), query, liveAiEnabled: true, ...over });
  return { routes, calls, db };
}
const post = (routes, body, headers) => routes.handle({ method: "POST", pathname: "/api/transcript", headers, text: typeof body === "string" ? body : JSON.stringify(body) });

test("transcript: no token and bad tokens give 401", async () => {
  const { routes, calls } = setup();
  assert.equal((await post(routes, record(), {})).status, 401);
  assert.equal((await post(routes, record(), auth("garbage"))).status, 401);
  assert.equal((await post(routes, record(), auth(token({ exp: NOW / 1000 - 5 })))).status, 401);
  assert.equal((await post(routes, record(), auth(token({ aud: "other" })))).status, 401);
  assert.equal(calls.length, 0);
});

test("chat guard: 401 without a valid token, passes with one", async () => {
  const { routes } = setup();
  assert.equal((await routes.guardChat({})).status, 401);
  assert.equal((await routes.guardChat(auth(token({ aud: "other" })))).status, 401);
  assert.equal(await routes.guardChat(auth(token())), null);
});

test("chat guard: per user limit gives 429 with Retry-After, other users unaffected", async () => {
  const { routes } = setup({ userCallsPerHour: 2 });
  const a = auth(token());
  assert.equal(await routes.guardChat(a), null);
  assert.equal(await routes.guardChat(a), null);
  const r = await routes.guardChat(a);
  assert.equal(r.status, 429);
  assert.ok(r.headers["Retry-After"]);
  assert.equal(await routes.guardChat(auth(token({ sub: "user-2" }))), null);
});

test("transcript: user_id in the body is ignored; RA stored as RA", async () => {
  const { routes, calls } = setup();
  const r = await post(routes, record({ user_id: "evil", userId: "evil", raName: "Sam" }), auth(token()));
  assert.equal(r.status, 200);
  const ins = calls.find(c => /insert/i.test(c.text));
  assert.equal(ins.params[0], "user-1");
  assert.ok(!ins.params.some(p => p === "evil"));
  assert.equal(ins.params[1], "roommate-conflict");
  assert.ok(!ins.text.includes("user-1"), "parameterized");
  assert.ok(JSON.parse(ins.params[7]).every(l => l.role !== "ra" || l.sender === "RA"));
  assert.ok(!JSON.stringify(ins.params).includes("raName"));
});

test("transcript: scenario_id from the record when valid", async () => {
  const { routes, calls } = setup();
  await post(routes, record({ scenario_id: "other-case" }), auth(token()));
  assert.equal(calls.find(c => /insert/i.test(c.text)).params[1], "other-case");
});

test("transcript: oversized body, API keys and database secrets are refused", async () => {
  const { routes, calls } = setup();
  assert.equal((await post(routes, "x".repeat(210 * 1024), auth(token()))).status, 413);
  assert.equal((await post(routes, record({ note: "sk-or-v1-abc" }), auth(token()))).status, 400);
  assert.equal((await post(routes, record({ note: "postgresql://bob:abcdefghijkl123@host/db" }), auth(token()))).status, 400);
  assert.equal((await post(routes, record({ note: "npg_abcdefghijkl" }), auth(token()))).status, 400);
  assert.equal(calls.filter(c => /insert/i.test(c.text)).length, 0);
});

test("transcript: per user daily session limit gives 429", async () => {
  const { routes, calls } = setup({ count: 10, userSessionsPerDay: 10 });
  assert.equal((await post(routes, record(), auth(token()))).status, 429);
  assert.equal(calls.filter(c => /insert/i.test(c.text)).length, 0);
});

test("sessions: list needs a token and filters on user_id", async () => {
  const { routes, calls } = setup();
  assert.equal((await routes.handle({ method: "GET", pathname: "/api/sessions", headers: {} })).status, 401);
  const r = await routes.handle({ method: "GET", pathname: "/api/sessions", headers: auth(token()) });
  assert.equal(r.status, 200);
  assert.deepEqual(calls.at(-1).params, ["user-1"]);
  assert.ok(!/transcript/.test(calls.at(-1).text));
});

test("sessions: another user's session gives 404 for read and delete; owner can read and delete", async () => {
  const { routes, db } = setup();
  const saved = await post(routes, record(), auth(token()));
  const id = saved.body.id;
  const bob = auth(token({ sub: "user-2" }));
  const get = (h, i = id) => routes.handle({ method: "GET", pathname: "/api/sessions/" + i, headers: h });
  const del = (h, i = id) => routes.handle({ method: "DELETE", pathname: "/api/sessions/" + i, headers: h });
  assert.equal((await get(bob)).status, 404);
  assert.equal((await del(bob)).status, 404);
  assert.ok(db.has(id), "bob did not delete it");
  assert.equal((await get(auth(token()))).status, 200);
  assert.equal((await get(auth(token()), "not-a-uuid")).status, 404);
  assert.equal((await del(auth(token()))).status, 200);
  assert.equal((await get(auth(token()))).status, 404);
});

test("no database: transcript falls back to files", async () => {
  const saved = [];
  const routes = createApiRoutes({ verifyUser: verifier(), query: null, liveAiEnabled: false, saveFile: (r, d) => (saved.push([r, d]), "x.json") });
  const r = await post(routes, record(), {});
  assert.equal(r.status, 200);
  assert.equal(saved.length, 1);
  assert.equal(saved[0][0].scenario_id, "roommate-conflict");
});

test("daily cap: 400 unauthenticated chat calls leave it untouched, and none are told the cap is reached", async () => {
  let reachedCalls = 0, counted = 0;
  const dailyCap = { reached: () => (reachedCalls++, true), count: () => counted++ };
  const { routes } = setup({ dailyCap, userCallsPerHour: 1000 });
  for (let i = 0; i < 400; i++) {
    const r = await routes.guardChat(i % 2 ? {} : auth(token({ aud: "other" })));
    assert.equal(r.status, 401);
  }
  assert.equal(reachedCalls, 0);
  assert.equal(counted, 0);
  // A logged in user does reach the cap check, which still returns 503 when it is full.
  assert.equal((await routes.guardChat(auth(token()))).status, 503);
  assert.equal(reachedCalls, 1);
  assert.equal(counted, 0, "guardChat only checks; the server counts after validation");
});

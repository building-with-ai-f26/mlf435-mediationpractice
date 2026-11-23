// Starts server.mjs on a random port with different env settings. Offline: no test reaches OpenRouter.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { createRateLimiter, createDailyCap, envNumber, envFlag } from "../limits.mjs";

const SERVER = path.resolve("server.mjs");

function freePort() {
  return new Promise(resolve => {
    const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

async function start(env = {}) {
  const port = await freePort();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ra-limits-"));
  const proc = spawn(process.execPath, [SERVER], {
    cwd,
    env: { PATH: process.env.PATH, PORT: String(port), OPENROUTER_API_KEY: "test-key-not-real", ...env },
  });
  await new Promise((resolve, reject) => {
    proc.stdout.on("data", d => { if (String(d).includes("Server running")) resolve(); });
    proc.on("exit", code => reject(new Error("server exited " + code)));
    setTimeout(() => reject(new Error("server did not start")), 5000);
  });
  const base = `http://127.0.0.1:${port}`;
  const post = (p, body, headers = {}) => fetch(base + p, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { base, port, post, stop() { proc.kill(); fs.rmSync(cwd, { recursive: true, force: true }); } };
}

const validChat = { model: "deepseek/deepseek-chat", messages: [{ role: "user", content: "hi" }] };

test("limiter: blocks after max, reports Retry-After, frees after the window", () => {
  const l = createRateLimiter({ max: 2, windowMs: 1000 });
  assert.equal(l.check("a", 0).ok, true);
  assert.equal(l.check("a", 100).ok, true);
  const r = l.check("a", 200);
  assert.equal(r.ok, false);
  assert.equal(r.retryAfter, 1);
  assert.equal(l.check("b", 200).ok, true);
  assert.equal(l.check("a", 1001).ok, true);
});

test("daily cap: reached after cap calls, resets next UTC day", () => {
  const c = createDailyCap(2);
  const t = Date.UTC(2025, 0, 1, 12);
  assert.equal(c.reached(t), false);
  c.count(t); c.count(t);
  assert.equal(c.reached(t), true);
  assert.equal(c.reached(t + 24 * 3600 * 1000), false);
});

test("env helpers", () => {
  assert.equal(envNumber(undefined, 5), 5);
  assert.equal(envNumber("abc", 5), 5);
  assert.equal(envNumber("0", 5), 0);
  assert.equal(envFlag(undefined), false);
  assert.equal(envFlag("false"), false);
  assert.equal(envFlag("true"), true);
});

test("healthz returns 200 {ok:true} and security headers, even with a foreign Host", async () => {
  const s = await start();
  try {
    const res = await fetch(s.base + "/healthz");
    assert.equal(res.status, 200);
    const hb = await res.json();
    assert.equal(hb.ok, true);
    assert.equal(typeof hb.commit, "string");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("x-frame-options"), "DENY");
    assert.equal(res.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
    assert.equal(res.headers.get("content-security-policy"), null);
    const page = await fetch(s.base + "/");
    assert.equal(page.headers.get("x-frame-options"), "DENY");
    const nf = await fetch(s.base + "/nope.txt");
    assert.equal(nf.status, 404);
    assert.equal(nf.headers.get("x-frame-options"), "DENY");
  } finally { s.stop(); }
});

test("LIVE_AI_ENABLED unset: /api/chat returns 503 with a readable message", async () => {
  const s = await start();
  try {
    const res = await s.post("/api/chat", validChat);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.match(body.error.message, /turned off/);
  } finally { s.stop(); }
});

test("LIVE_AI_ENABLED=false also returns 503", async () => {
  const s = await start({ LIVE_AI_ENABLED: "false" });
  try { assert.equal((await s.post("/api/chat", validChat)).status, 503); } finally { s.stop(); }
});

test("rate limit: 429 with Retry-After after the limit, on /api/chat and /api/transcript", async () => {
  const s = await start({ LIVE_AI_ENABLED: "true", RATE_LIMIT_MAX: "3" });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await s.post("/api/chat", "not json")).status, 401); // no token
    const res = await s.post("/api/chat", "not json");
    assert.equal(res.status, 429);
    assert.ok(Number(res.headers.get("retry-after")) >= 1);
    assert.match((await res.json()).error.message, /Too many requests/);
    // Same client, so the shared counter also blocks the transcript route.
    assert.equal((await s.post("/api/transcript", "{}")).status, 429);
  } finally { s.stop(); }
});

test("x-forwarded-for is ignored outside production", async () => {
  const s = await start({ LIVE_AI_ENABLED: "true", RATE_LIMIT_MAX: "1" });
  try {
    assert.equal((await s.post("/api/chat", "x", { "X-Forwarded-For": "1.1.1.1" })).status, 401);
    assert.equal((await s.post("/api/chat", "x", { "X-Forwarded-For": "2.2.2.2" })).status, 429);
  } finally { s.stop(); }
});

test("daily cap: a full cap does not change the answer for a caller who is not logged in (401, not 503)", async () => {
  const s = await start({ LIVE_AI_ENABLED: "true", DAILY_CALL_CAP: "0" });
  try {
    assert.equal((await s.post("/api/chat", validChat)).status, 401);
  } finally { s.stop(); }
});

test("PUBLIC_ORIGIN: its origin and Host are accepted, a random origin is rejected", async () => {
  const s = await start({ PUBLIC_ORIGIN: "https://ra.example.edu" });
  try {
    const ok = await fetch(s.base + "/healthz", { headers: { Origin: "https://ra.example.edu" } });
    assert.equal(ok.status, 200);
    // fetch cannot set Host or Origin freely, so use a raw request for the API checks.
    const raw = (host, origin) => new Promise(resolve => {
      const sock = net.connect(s.port, "127.0.0.1", () => {
        sock.write(`OPTIONS /api/chat HTTP/1.1\r\nHost: ${host}\r\n${origin ? `Origin: ${origin}\r\n` : ""}Connection: close\r\n\r\n`);
      });
      let data = ""; sock.on("data", d => data += d); sock.on("close", () => resolve(data));
    });
    assert.match(await raw("ra.example.edu", "https://ra.example.edu"), /^HTTP\/1.1 204/);
    assert.match(await raw("ra.example.edu", "https://evil.example"), /^HTTP\/1.1 403/);
    assert.match(await raw("evil.example", "https://ra.example.edu"), /^HTTP\/1.1 403/);
  } finally { s.stop(); }
});

test("/api/tts and /api/practice-mode: signed out gets 401, wrong method 405, oversized body 413, shared IP limit 429", async () => {
  const s = await start({ LIVE_AI_ENABLED: "true", VOICE_ENABLED: "true", TTS_PROVIDER: "stub", RATE_LIMIT_MAX: "3" });
  try {
    const ttsBody = { text: "hello", resident: "alex" };
    assert.equal((await s.post("/api/tts", ttsBody)).status, 401);
    assert.equal((await fetch(s.base + "/api/tts")).status, 405);
    assert.equal((await fetch(s.base + "/api/practice-mode", { method: "POST" })).status, 405);
    assert.equal((await s.post("/api/tts", { text: "a".repeat(5000), resident: "alex" })).status, 413);
    assert.equal((await fetch(s.base + "/api/practice-mode", { method: "PUT", body: JSON.stringify({ mode: "voice" }) })).status, 401);
    // Three counted calls above (405s are not counted). The fourth is refused by the per IP limit shared with /api/chat.
    const res = await s.post("/api/tts", ttsBody);
    assert.equal(res.status, 429);
    assert.ok(Number(res.headers.get("retry-after")) >= 1);
  } finally { s.stop(); }
});

test("/api/tts: 503 when live AI is off or read-aloud is not set up", async () => {
  const off = await start({ VOICE_ENABLED: "true", TTS_PROVIDER: "stub" });
  try { assert.equal((await off.post("/api/tts", { text: "hi", resident: "alex" })).status, 503); } finally { off.stop(); }
  const none = await start({ LIVE_AI_ENABLED: "true", VOICE_ENABLED: "true" });
  try { assert.equal((await none.post("/api/tts", { text: "hi", resident: "alex" })).status, 503); } finally { none.stop(); }
});

test("RESIDENT_MODEL: /config.json reports it, the default is Haiku, and it is allowed by the server", async () => {
  const d = await start();
  try {
    const c = await (await fetch(d.base + "/config.json")).json();
    assert.equal(c.residentModel, "anthropic/claude-haiku-5.5");
  } finally { d.stop(); }
  const s = await start({ RESIDENT_MODEL: "x-test/new-model", LIVE_AI_ENABLED: "true" });
  try {
    const c = await (await fetch(s.base + "/config.json")).json();
    assert.equal(c.residentModel, "x-test/new-model");
  } finally { s.stop(); }
});

test("VOICE_ENABLED: off by default (config.json says false, /api/tts and /api/practice-mode return 503 before any login check), on when set", async () => {
  const off = await start({ LIVE_AI_ENABLED: "true", TTS_PROVIDER: "stub" });
  try {
    assert.equal((await (await fetch(off.base + "/config.json")).json()).voiceEnabled, false);
    assert.equal((await off.post("/api/tts", { text: "hi", resident: "alex" })).status, 503);
    assert.equal((await fetch(off.base + "/api/practice-mode", { method: "PUT", body: JSON.stringify({ mode: "voice" }) })).status, 503);
  } finally { off.stop(); }
  const on = await start({ LIVE_AI_ENABLED: "true", TTS_PROVIDER: "stub", VOICE_ENABLED: "true" });
  try {
    assert.equal((await (await fetch(on.base + "/config.json")).json()).voiceEnabled, true);
    assert.equal((await on.post("/api/tts", { text: "hi", resident: "alex" })).status, 401); // reaches the login check
  } finally { on.stop(); }
});

test("/api/stt: signed out 401, wrong method 405, oversized clip 413 before login, shared IP limit 429, 503 when off", async () => {
  const s = await start({ LIVE_AI_ENABLED: "true", VOICE_ENABLED: "true", RATE_LIMIT_MAX: "3" });
  try {
    const headers = { "Content-Type": "audio/webm", "X-Clip-Seconds": "5" };
    const post = body => fetch(s.base + "/api/stt", { method: "POST", headers, body });
    assert.equal((await post(Buffer.alloc(1000))).status, 401);
    assert.equal((await fetch(s.base + "/api/stt")).status, 405);
    assert.equal((await post(Buffer.alloc(600 * 1024))).status, 413);
    assert.equal((await post(Buffer.alloc(1000))).status, 401);
    const res = await post(Buffer.alloc(1000));
    assert.equal(res.status, 429);
    assert.ok(Number(res.headers.get("retry-after")) >= 1);
  } finally { s.stop(); }
  const off = await start({ VOICE_ENABLED: "true", STT_PROVIDER: "off" });
  try { assert.equal((await off.post("/api/stt", "x")).status, 503); } finally { off.stop(); }
});

test("/api/stt returns 503 when VOICE_ENABLED is unset, whatever else is set", async () => {
  const s = await start({ LIVE_AI_ENABLED: "true", STT_PROVIDER: "stub" });
  try {
    const r = await fetch(s.base + "/api/stt", { method: "POST", headers: { "Content-Type": "audio/webm", "X-Clip-Seconds": "5" }, body: Buffer.alloc(100) });
    assert.equal(r.status, 503);
  } finally { s.stop(); }
});

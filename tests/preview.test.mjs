// Pull request preview safety and /healthz commit. Starts server.mjs on a random port. Offline.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";

const SERVER = path.resolve("server.mjs");
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });

async function start(env = {}) {
  const port = await freePort();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ra-preview-"));
  const proc = spawn(process.execPath, [SERVER], { cwd, env: { PATH: process.env.PATH, PORT: String(port), OPENROUTER_API_KEY: "test-key-not-real", ...env } });
  await new Promise((resolve, reject) => {
    proc.stdout.on("data", d => { if (String(d).includes("Server running")) resolve(); });
    proc.on("exit", c => reject(new Error("server exited " + c)));
    setTimeout(() => reject(new Error("server did not start")), 5000);
  });
  const base = `http://127.0.0.1:${port}`;
  const post = (p, body) => fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { base, post, cwd, stop() { proc.kill(); fs.rmSync(cwd, { recursive: true, force: true }); } };
}

const chat = { model: "deepseek/deepseek-chat", messages: [{ role: "user", content: "hi" }] };

test("healthz returns ok and the Render commit", async () => {
  const s = await start({ RENDER_GIT_COMMIT: "abc123def456" });
  try {
    const r = await fetch(s.base + "/healthz");
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, commit: "abc123def456" });
  } finally { s.stop(); }
});

test("preview: LIVE_AI_ENABLED=true is ignored, /api/chat returns 503", async () => {
  const s = await start({ IS_PULL_REQUEST: "true", LIVE_AI_ENABLED: "true" });
  try {
    const r = await s.post("/api/chat", chat);
    assert.equal(r.status, 503);
  } finally { s.stop(); }
});

test("preview: /api/transcript writes nothing", async () => {
  const s = await start({ IS_PULL_REQUEST: "true", LIVE_AI_ENABLED: "true" });
  try {
    const r = await s.post("/api/transcript", { scenario: "noise" });
    assert.equal(r.status, 503);
    assert.equal(fs.existsSync(path.join(s.cwd, "transcripts")), false);
  } finally { s.stop(); }
});

test("not a preview: IS_PULL_REQUEST=false leaves live AI on (request reaches the login check)", async () => {
  const s = await start({ IS_PULL_REQUEST: "false", LIVE_AI_ENABLED: "true" });
  try {
    const r = await s.post("/api/chat", { model: "not-allowed", messages: [] });
    assert.equal(r.status, 401); // live AI is on, so a Google token is now required
  } finally { s.stop(); }
});

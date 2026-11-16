import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { validateTranscript, saveTranscript, livePath, MAX_TRANSCRIPT_BYTES, INDEX_HEADER } from "../liveTranscript.mjs";
import { buildLiveRecord, scrubName, newLiveLog, addUsage } from "../public/liveRecord.js";
import { redactRecord, exportFiles, parseArgs } from "../tools/export-live.mjs";

const good = () => ({
  scenario: "noise", difficulty: "medium", partial: false,
  transcript: [{ turn: 0, role: "resident", sender: "Alex", text: "Hi" }, { turn: 1, role: "ra", sender: "RA", text: "Hello" }],
  graders: [{ name: "DeepSeek", ok: true, answers: {}, metCount: 3 }], result: { met: 3, total: 15, score: 20 },
  evil: "dropped",
});

// ---- validation and saving (no server) ----

test("validateTranscript keeps known fields, adds source and the server's git commit", () => {
  const { record } = validateTranscript(JSON.stringify(good()), { gitCommit: "abc1234" });
  assert.equal(record.source, "live");
  assert.equal(record.gitCommit, "abc1234");
  assert.equal(record.evil, undefined);
  assert.equal(record.scenario, "noise");
});

test("validateTranscript refuses sk-or- anywhere, and the loaded key", () => {
  const bad = good(); bad.transcript[1].text = "my key is sk-or-v1-abc";
  assert.match(validateTranscript(JSON.stringify(bad)).error, /API key/);
  const keyed = good(); keyed.transcript[1].text = "secret-key-value-123";
  assert.match(validateTranscript(JSON.stringify(keyed), { key: "secret-key-value-123" }).error, /API key/);
});

test("validateTranscript rejects bad shapes and bodies over 200KB", () => {
  assert.equal(validateTranscript("not json").error, "Invalid JSON");
  assert.ok(validateTranscript(JSON.stringify({ ...good(), transcript: [] })).error);
  assert.ok(validateTranscript(JSON.stringify({ ...good(), scenario: 5 })).error);
  const big = good(); big.transcript[1].text = "x".repeat(MAX_TRANSCRIPT_BYTES);
  assert.equal(validateTranscript(JSON.stringify(big)).status, 413);
});

test("saveTranscript writes the dated file and appends index rows", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-"));
  const { record } = validateTranscript(JSON.stringify(good()));
  const now = new Date(2026, 0, 5, 9, 3, 7);
  const rel = saveTranscript(record, dir, now);
  assert.equal(rel, "2026-01-05/090307-noise-medium.json");
  assert.equal(livePath(now, "guest policy", "hard"), "2026-01-05/090307-guest-policy-hard.json");
  const rel2 = saveTranscript(record, dir, now);
  assert.equal(rel2, "2026-01-05/090307-noise-medium-2.json");
  const rows = fs.readFileSync(path.join(dir, "index.csv"), "utf-8").trim().split("\n");
  assert.equal(rows[0], INDEX_HEADER);
  assert.equal(rows.length, 3);
  assert.match(rows[1], /2026-01-05\/090307-noise-medium\.json,noise,medium,1,no,3,20,3,,$/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, rel), "utf-8")).source, "live");
});

// ---- the real route, in a child process with its own cwd and .env ----

let proc, port, cwd;
const url = p => `http://127.0.0.1:${port}${p}`;
const post = (body, headers = {}) => fetch(url("/api/transcript"), { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body });

before(async () => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "srv-"));
  fs.writeFileSync(path.join(cwd, ".env"), "OPENROUTER_API_KEY=sk-or-test-key-for-tests\n");
  fs.mkdirSync(path.join(cwd, "public"));
  port = 40000 + Math.floor(Math.random() * 20000);
  proc = spawn(process.execPath, [path.resolve("server.mjs")], { cwd, env: { ...process.env, PORT: String(port) } });
  await new Promise((resolve, reject) => {
    proc.stdout.on("data", d => { if (String(d).includes("Server running")) resolve(); });
    proc.on("exit", c => reject(new Error(`server exited ${c}`)));
    setTimeout(() => reject(new Error("server did not start")), 5000);
  });
});
after(() => proc && proc.kill());

test("route: saves a good transcript under transcripts/live", async () => {
  const res = await post(JSON.stringify(good()));
  assert.equal(res.status, 200);
  const { file } = await res.json();
  const saved = JSON.parse(fs.readFileSync(path.join(cwd, "transcripts", "live", file), "utf-8"));
  assert.equal(saved.source, "live");
  assert.ok(fs.existsSync(path.join(cwd, "transcripts", "live", "index.csv")));
});

test("route: bad origin is refused, same origin is accepted", async () => {
  assert.equal((await post(JSON.stringify(good()), { Origin: "http://evil.example" })).status, 403);
  assert.equal((await post(JSON.stringify(good()), { Origin: `http://localhost:${port}` })).status, 200);
});

test("route: body over 200KB gets 413, and a body between 64KB and 200KB is allowed", async () => {
  const big = good(); big.transcript[1].text = "x".repeat(MAX_TRANSCRIPT_BYTES + 10);
  assert.equal((await post(JSON.stringify(big))).status, 413);
  const mid = good(); mid.transcript[1].text = "x".repeat(100 * 1024);
  assert.equal((await post(JSON.stringify(mid))).status, 200);
});

test("route: content with sk-or- is refused and nothing new is written", async () => {
  const before = fs.readdirSync(path.join(cwd, "transcripts", "live")).length;
  const bad = good(); bad.transcript[1].text = "sk-or-v1-leaked";
  const res = await post(JSON.stringify(bad));
  assert.equal(res.status, 400);
  assert.equal(fs.readFileSync(path.join(cwd, "transcripts", "live", "index.csv"), "utf-8").includes("leaked"), false);
  assert.equal(fs.readdirSync(path.join(cwd, "transcripts", "live")).length, before);
});

test("route: GET is not allowed", async () => {
  assert.equal((await fetch(url("/api/transcript"))).status, 405);
});

// ---- record building ----

test("scrubName replaces the RA name everywhere, and skips unsafe names", () => {
  assert.deepEqual(scrubName({ a: "Hi, I'm Sam. thanks sam!", b: ["Samuel"] }, "Sam"), { a: "Hi, I'm RA. thanks RA!", b: ["Samuel"] });
  assert.equal(scrubName("you and Alex", "You"), "you and Alex");
  assert.equal(scrubName("Alex said hi", "Alex"), "Alex said hi");
});

test("buildLiveRecord: RA role, no RA name, routing, openness, usage", () => {
  const session = { raName: "Sam", topic: "noise", difficulty: "hard", turnHistory: [{ sender: "Alex", text: "a" }, { sender: "Jordan", text: "j" }, { sender: "Sam", text: "Hi, Sam here" }] };
  const live = newLiveLog();
  live.opennessStart = { alex: 0, jordan: 0 };
  addUsage(live, "resident", { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
  live.turns.push({ turn: 1, at: "t", ra: "Hi, Sam here", replies: [{ sender: "Alex", text: "Thanks Sam" }, { sender: "Jordan", text: "ok" }], route: { to: "both", responders: ["Alex", "Jordan"], source: "code" }, tags: null, opennessBefore: { alex: 0, jordan: 0 }, opennessAfter: { alex: 1, jordan: 0 } });
  const rec = buildLiveRecord({ session, live, models: { resident: "m" }, rubricVersion: 1, now: new Date(0) });
  assert.equal(JSON.stringify(rec).includes("Sam"), false);
  assert.deepEqual(rec.transcript.map(t => [t.turn, t.role, t.sender]), [[0, "resident", "Alex"], [0, "resident", "Jordan"], [1, "ra", "RA"], [1, "resident", "Alex"], [1, "resident", "Jordan"]]);
  assert.equal(rec.transcript[3].text, "Thanks RA");
  assert.deepEqual(rec.routing, [{ turn: 1, to: "both", responders: ["Alex", "Jordan"], source: "code" }]);
  assert.equal(rec.openness.turns[0].openness_after.alex, 1);
  assert.equal(rec.usage.resident.total_tokens, 15);
  assert.equal(rec.scenario, "noise");
});

// ---- export redaction ----

test("redactRecord removes email and phone lines and keeps the rest", () => {
  const rec = { source: "live", transcript: [
    { sender: "RA", text: "Email me at pat@example.edu\nLet's talk tomorrow." },
    { sender: "Alex", text: "Call 555-123-4567" },
    { sender: "Jordan", text: "My number is +1 (212) 555 0100 ok" },
    { sender: "RA", text: "Room 12 on floor 3, 2 quiet hours." },
  ] };
  const { record, removed } = redactRecord(rec);
  assert.equal(removed, 3);
  assert.equal(record.transcript[0].text, "Let's talk tomorrow.");
  assert.equal(record.transcript[1].text, "[line removed]");
  assert.equal(record.transcript[2].text, "[line removed]");
  assert.equal(record.transcript[3].text, "Room 12 on floor 3, 2 quiet hours.");
  assert.equal(record.redacted, true);
});

test("redactRecord with --name replaces the name; exportFiles writes only redacted live files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exp-"));
  const day = path.join(dir, "live", "2026-01-05"); fs.mkdirSync(day, { recursive: true });
  fs.writeFileSync(path.join(day, "a.json"), JSON.stringify({ source: "live", transcript: [{ sender: "RA", text: "I'm Pat, pat@x.org" }, { sender: "RA", text: "Pat here again" }] }));
  fs.writeFileSync(path.join(day, "b.json"), JSON.stringify({ source: "simulator" }));
  fs.writeFileSync(path.join(day, "c.json"), JSON.stringify({ source: "live", transcript: [{ text: "sk-or-v1-x" }] }));
  const out = path.join(dir, "shared");
  const res = exportFiles([path.join(dir, "live")], out, { name: "Pat" });
  assert.equal(res.filter(r => !r.skipped).length, 1);
  assert.deepEqual(res.filter(r => r.skipped).map(r => r.skipped).sort(), ["contains sk-or-", "not a live session file"]);
  const written = fs.readFileSync(path.join(out, "2026-01-05", "a.json"), "utf-8");
  assert.equal(written.includes("Pat"), false);
  assert.equal(written.includes("pat@x.org"), false);
  assert.ok(!fs.existsSync(path.join(out, "2026-01-05", "b.json")));
});

test("export-live parseArgs needs an input and rejects unknown flags", () => {
  assert.throws(() => parseArgs([]), /at least one/);
  assert.throws(() => parseArgs(["x", "--bad"]), /Unknown flag/);
  assert.deepEqual(parseArgs(["x", "--out", "o", "--name", "N"]), { inputs: ["x"], out: "o", name: "N" });
});

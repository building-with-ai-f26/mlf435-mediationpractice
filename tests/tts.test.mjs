// Read-aloud: providers, /api/tts and /api/practice-mode logic, voice ids, and the live view helpers. Offline, stub provider only.
import test from "node:test";
import assert from "node:assert/strict";
import { createApiRoutes } from "../apiRoutes.mjs";
import { createDailyCap } from "../limits.mjs";
import { createTtsProvider, STUB_AUDIO } from "../tts.mjs";
import { VOICE_IDS, MAX_TTS_CHARS, PRACTICE_MODES, DEFAULT_PRACTICE_MODE } from "../public/config.js";
import { normalizeMode, readStoredMode, writeStoredMode, readStoredMuted, writeStoredMuted, ttsText, estimateDurationMs, revealFraction, revealText } from "../public/voice.js";

const AUTH = { authorization: "Bearer good" };
const j = o => JSON.stringify(o);
function make(over = {}) {
  const logged = [];
  const tts = createTtsProvider("stub");
  const routes = createApiRoutes({
    verifyUser: async t => (t === "good" ? { id: "user-1" } : t === "other" ? { id: "user-2" } : null),
    liveAiEnabled: true, voiceEnabled: true, tts, log: (...a) => logged.push(a.join(" ")), ...over,
  });
  return { routes, tts, logged };
}
async function voice(routes, headers = AUTH) { return routes.setPracticeMode(headers, j({ mode: "voice" })); }

test("TTS_PROVIDER: empty is off, stub works, unknown throws", async () => {
  assert.equal(createTtsProvider(undefined), null);
  assert.equal(createTtsProvider(""), null);
  assert.equal(createTtsProvider("off"), null);
  assert.throws(() => createTtsProvider("mystery"), /Unknown TTS_PROVIDER/);
  const p = createTtsProvider("stub");
  assert.equal((await p.synthesize({ text: "hi", voiceId: "v" })).equals(STUB_AUDIO), true);
  assert.equal(p.lastVoiceId, "v");
  assert.equal(JSON.stringify(p).includes("hi"), false); // the stub never keeps the text
});

test("config: two different voice ids, modes default to text", () => {
  assert.ok(VOICE_IDS.alex && VOICE_IDS.jordan);
  assert.notEqual(VOICE_IDS.alex, VOICE_IDS.jordan);
  assert.deepEqual(PRACTICE_MODES, ["text", "voice"]);
  assert.equal(DEFAULT_PRACTICE_MODE, "text");
  assert.equal(MAX_TTS_CHARS, 600);
});

test("/api/tts: signed out gets 401, a bad token gets 401", async () => {
  const { routes } = make();
  const body = j({ text: "hello", resident: "alex" });
  assert.equal((await routes.speak({}, body)).status, 401);
  assert.equal((await routes.speak({ authorization: "Bearer nope" }, body)).status, 401);
});

test("/api/tts: refuses in text mode (default) with 409, works after voice is chosen, refuses again after text", async () => {
  const { routes } = make();
  const body = j({ text: "hello", resident: "alex" });
  assert.equal((await routes.speak(AUTH, body)).status, 409);
  assert.equal((await voice(routes)).status, 200);
  const r = await routes.speak(AUTH, body);
  assert.equal(r.status, 200);
  assert.equal(r.headers["Content-Type"], "audio/mpeg");
  assert.equal(r.headers["Cache-Control"], "no-store");
  assert.equal(Buffer.isBuffer(r.audio), true);
  assert.equal((await routes.setPracticeMode(AUTH, j({ mode: "text" }))).status, 200);
  assert.equal((await routes.speak(AUTH, body)).status, 409);
});

test("practice mode is per user: user 1 in voice mode does not open voice for user 2", async () => {
  const { routes } = make();
  await voice(routes);
  assert.equal((await routes.speak({ authorization: "Bearer other" }, j({ text: "hi", resident: "alex" }))).status, 409);
});

test("practice-mode route: needs login, only text or voice", async () => {
  const { routes } = make();
  assert.equal((await routes.setPracticeMode({}, j({ mode: "voice" }))).status, 401);
  assert.equal((await routes.setPracticeMode(AUTH, j({ mode: "loud" }))).status, 400);
  assert.equal((await routes.setPracticeMode(AUTH, "not json")).status, 400);
});

test("/api/tts: oversized text is refused (601), exactly 600 is fine, empty and wrong types are refused", async () => {
  const { routes, tts } = make();
  await voice(routes);
  const call = text => routes.speak(AUTH, j({ text, resident: "jordan" }));
  assert.equal((await call("a".repeat(601))).status, 400);
  assert.equal(tts.lastVoiceId, null); // refused before the provider
  assert.equal((await call("a".repeat(600))).status, 200);
  assert.equal((await call("")).status, 400);
  assert.equal((await call("   ")).status, 400);
  assert.equal((await call(42)).status, 400);
  assert.equal((await routes.speak(AUTH, j({ text: "hi", resident: "sam" }))).status, 400);
  assert.equal((await routes.speak(AUTH, j({ text: "hi" }))).status, 400);
  assert.equal((await routes.speak(AUTH, "{")).status, 400);
});

test("/api/tts: the voice comes from config by resident, a voiceId in the body is ignored", async () => {
  const { routes, tts } = make();
  await voice(routes);
  await routes.speak(AUTH, j({ text: "hi", resident: "alex", voiceId: "attacker-voice" }));
  assert.equal(tts.lastVoiceId, VOICE_IDS.alex);
  await routes.speak(AUTH, j({ text: "hi", resident: "jordan" }));
  assert.equal(tts.lastVoiceId, VOICE_IDS.jordan);
});

test("/api/tts: shares the per user hourly limit with chat and the daily cap", async () => {
  const a = make({ userCallsPerHour: 2 });
  await voice(a.routes);
  const body = j({ text: "hi", resident: "alex" });
  assert.equal((await a.routes.guardChat(AUTH)), null); // one chat call counts
  assert.equal((await a.routes.speak(AUTH, body)).status, 200); // second
  const r = await a.routes.speak(AUTH, body);
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers["Retry-After"]) >= 1);

  const cap = createDailyCap(1);
  const b = make({ dailyCap: cap });
  await voice(b.routes);
  assert.equal((await b.routes.speak(AUTH, body)).status, 200); // counts one
  assert.equal((await b.routes.speak(AUTH, body)).status, 503); // cap reached
  assert.equal((await b.routes.guardChat(AUTH)).status, 503); // chat sees the same cap
});

test("/api/tts: an invalid call does not use up the daily cap, and a signed out call never does", async () => {
  const cap = createDailyCap(1);
  const { routes } = make({ dailyCap: cap });
  await voice(routes);
  await routes.speak({}, j({ text: "hi", resident: "alex" }));
  await routes.speak(AUTH, j({ text: "a".repeat(601), resident: "alex" }));
  assert.equal(cap.reached(), false);
});

test("/api/tts: 503 when live AI is off or no provider is set", async () => {
  assert.equal((await make({ liveAiEnabled: false }).routes.speak(AUTH, "{}")).status, 503);
  assert.equal((await make({ tts: null }).routes.speak(AUTH, "{}")).status, 503);
});

test("/api/tts: a provider failure returns 502 and the log has no text, message or user id", async () => {
  const tts = { name: "x", synthesize: async () => { throw new Error("secret words from provider"); } };
  const { routes, logged } = make({ tts });
  await voice(routes);
  const r = await routes.speak(AUTH, j({ text: "private sentence", resident: "alex" }));
  assert.equal(r.status, 502);
  assert.deepEqual(logged, ["[tts-failed] Error"]);
  assert.ok(logged.every(l => !/private sentence|secret words|user-1/.test(l)));
});

test("live view helpers: mode storage, text cap, pacing, reveal", () => {
  const mem = new Map();
  const storage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v) };
  assert.equal(readStoredMode(storage), "text");
  writeStoredMode(storage, "voice");
  assert.equal(readStoredMode(storage), "voice");
  writeStoredMode(storage, "bogus");
  assert.equal(readStoredMode(storage), "text");
  assert.equal(readStoredMuted(storage), false);
  writeStoredMuted(storage, true);
  assert.equal(readStoredMuted(storage), true);
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(readStoredMode(broken), "text");
  assert.doesNotThrow(() => writeStoredMode(broken, "voice"));
  assert.equal(normalizeMode(undefined), "text");

  const long = "One short sentence. ".repeat(40);
  const cut = ttsText(long);
  assert.ok(cut.length <= 600 && cut.endsWith("."));
  assert.equal(ttsText("Hi there."), "Hi there.");

  assert.ok(estimateDurationMs("one two three four five") >= 800);
  assert.equal(revealFraction(0, 1000), 0);
  assert.equal(revealFraction(2000, 1000), 1);
  assert.equal(revealFraction(500, 0), 1);
  assert.equal(revealText("I hear you. That is hard.", 0), "");
  assert.equal(revealText("I hear you. That is hard.", 0.5), "I hear you.");
  assert.equal(revealText("I hear you.  That is hard.", 1), "I hear you.  That is hard.");
});

// ---------- Voice input (POST /api/stt) ----------
import fs from "node:fs";
import { createSttProvider, isRetiredVoiceModel } from "../tts.mjs";
import { MAX_STT_BYTES, MAX_STT_SECONDS } from "../public/config.js";

function makeStt(over = {}) {
  const logged = [];
  const stt = createSttProvider("stub");
  const routes = createApiRoutes({
    verifyUser: async t => (t === "good" ? { id: "user-1" } : t === "other" ? { id: "user-2" } : null),
    liveAiEnabled: true, voiceEnabled: true, stt, log: (...a) => logged.push(a.join(" ")), ...over,
  });
  return { routes, stt, logged };
}
const clip = (n = 1000) => Buffer.alloc(n, 1);
const H = (over = {}) => ({ ...AUTH, "content-type": "audio/webm;codecs=opus", "x-clip-seconds": "5", ...over });

test("STT_PROVIDER: stub by default, off/none turns it off, unknown throws, retired voice models are refused", () => {
  assert.equal(createSttProvider(undefined).name, "stub");
  assert.equal(createSttProvider("").name, "stub");
  assert.equal(createSttProvider("off"), null);
  assert.equal(createSttProvider("stub").streaming, false);
  assert.throws(() => createSttProvider("mystery"), /Unknown STT_PROVIDER/);
  for (const bad of ["tts-1", "tts-1-hd", "openai/tts-1-hd", "gpt-4o-mini-tts", "gpt-realtime-mini", "gemini-3.1-flash-live-preview", "google/gemini-3.1-flash-live-preview"]) {
    assert.equal(isRetiredVoiceModel(bad), true, bad);
    assert.throws(() => createSttProvider(bad), /retired voice model/, bad);
    assert.throws(() => createTtsProvider(bad), /retired voice model/, bad);
  }
  for (const fine of ["stub", "gpt-6-luna", "tts-2", "gemini-4-neon"]) assert.equal(isRetiredVoiceModel(fine), false, fine);
});

test("VOICE_ENABLED off (the default): speak and the practice mode route refuse with 503 even with a provider and live AI on", async () => {
  const { routes, tts } = make({ voiceEnabled: false });
  assert.equal((await routes.speak(AUTH, j({ text: "hi", resident: "alex" }))).status, 503);
  assert.equal((await routes.setPracticeMode(AUTH, j({ mode: "voice" }))).status, 503);
  assert.equal(tts.lastVoiceId, null);
  // Default of createApiRoutes is off too.
  const bare = createApiRoutes({ verifyUser: async () => ({ id: "u" }), liveAiEnabled: true, tts });
  assert.equal((await bare.speak(AUTH, j({ text: "hi", resident: "alex" }))).status, 503);
});

test("/api/stt: signed out and forged tokens get 401, before the audio is looked at", async () => {
  const { routes, stt } = makeStt();
  assert.equal((await routes.transcribe({ "content-type": "audio/webm", "x-clip-seconds": "5" }, clip())).status, 401);
  assert.equal((await routes.transcribe(H({ authorization: "Bearer nope" }), clip())).status, 401);
  assert.equal(stt.lastSize, null);
});

test("/api/stt: 409 in text mode, 200 with the transcript in voice mode, per user", async () => {
  const { routes, stt } = makeStt();
  assert.equal((await routes.transcribe(H(), clip())).status, 409);
  await routes.setPracticeMode(AUTH, j({ mode: "voice" }));
  const r = await routes.transcribe(H(), clip(2000));
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.text, "string");
  assert.equal(stt.lastSize, 2000);
  assert.equal((await routes.transcribe(H({ authorization: "Bearer other" }), clip())).status, 409);
});

test("/api/stt: oversized clip 413, too long 400, bad type 415, missing or bad length 400, empty 400", async () => {
  const { routes, stt } = makeStt();
  await routes.setPracticeMode(AUTH, j({ mode: "voice" }));
  assert.equal((await routes.transcribe(H(), clip(MAX_STT_BYTES + 1))).status, 413);
  assert.equal(stt.lastSize, null); // refused before the provider
  assert.equal((await routes.transcribe(H(), clip(MAX_STT_BYTES))).status, 200); // exactly the cap is fine
  assert.equal((await routes.transcribe(H({ "x-clip-seconds": String(MAX_STT_SECONDS + 1) }), clip())).status, 400);
  assert.equal((await routes.transcribe(H({ "x-clip-seconds": String(MAX_STT_SECONDS) }), clip())).status, 200);
  assert.equal((await routes.transcribe(H({ "x-clip-seconds": undefined }), clip())).status, 400);
  assert.equal((await routes.transcribe(H({ "x-clip-seconds": "abc" }), clip())).status, 400);
  assert.equal((await routes.transcribe(H({ "x-clip-seconds": "0" }), clip())).status, 400);
  assert.equal((await routes.transcribe(H({ "content-type": "text/html" }), clip())).status, 415);
  assert.equal((await routes.transcribe(H(), Buffer.alloc(0))).status, 400);
  assert.equal((await routes.transcribe(H(), "not a buffer")).status, 400);
});

test("/api/stt: shares the hourly limit and the daily cap with chat; invalid clips do not use the cap", async () => {
  const a = makeStt({ userCallsPerHour: 2 });
  await a.routes.setPracticeMode(AUTH, j({ mode: "voice" }));
  assert.equal(await a.routes.guardChat(AUTH), null);
  assert.equal((await a.routes.transcribe(H(), clip())).status, 200);
  const r = await a.routes.transcribe(H(), clip());
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers["Retry-After"]) >= 1);

  const cap = createDailyCap(1);
  const b = makeStt({ dailyCap: cap });
  await b.routes.setPracticeMode(AUTH, j({ mode: "voice" }));
  await b.routes.transcribe(H(), clip(MAX_STT_BYTES + 1)); // refused, not counted
  await b.routes.transcribe({ "content-type": "audio/webm", "x-clip-seconds": "5" }, clip()); // signed out, not counted
  assert.equal(cap.reached(), false);
  assert.equal((await b.routes.transcribe(H(), clip())).status, 200);
  assert.equal((await b.routes.transcribe(H(), clip())).status, 503);
});

test("/api/stt: 503 when live AI is off or the provider is off; a provider failure gives 502 and logs only the name", async () => {
  assert.equal((await makeStt({ liveAiEnabled: false }).routes.transcribe(H(), clip())).status, 503);
  assert.equal((await makeStt({ stt: null }).routes.transcribe(H(), clip())).status, 503);
  const stt = { name: "x", streaming: false, transcribe: async () => { throw new Error("secret words from provider"); } };
  const { routes, logged } = makeStt({ stt });
  await routes.setPracticeMode(AUTH, j({ mode: "voice" }));
  assert.equal((await routes.transcribe(H(), clip())).status, 502);
  assert.deepEqual(logged, ["[stt-failed] Error"]);
});

test("audio is never kept: the stub keeps only a byte count and the route code never writes files", () => {
  const p = createSttProvider("stub");
  assert.deepEqual(Object.keys(p).sort(), ["lastSize", "name", "streaming", "transcribe"]);
  const src = fs.readFileSync(new URL("../apiRoutes.mjs", import.meta.url), "utf8");
  const stt = src.slice(src.indexOf("async function transcribe"), src.indexOf("return { authenticate"));
  assert.doesNotMatch(stt, /writeFile|createWriteStream|appendFile|tmpdir|mkdtemp|fs\./);
  const server = fs.readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  const reader = server.slice(server.indexOf("function readBuffer"), server.indexOf("function readBody"));
  assert.doesNotMatch(reader, /writeFile|createWriteStream|tmpdir|mkdtemp/);
});

test("VOICE_ENABLED off: /api/stt refuses with 503 before looking at the audio", async () => {
  const { routes, stt } = makeStt({ voiceEnabled: false });
  assert.equal((await routes.transcribe(H(), clip())).status, 503);
  assert.equal(stt.lastSize, null);
});

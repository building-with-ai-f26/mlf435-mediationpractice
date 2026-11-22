import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs, readSettings, buildQueries, medianFromHistogram, summarize, buildAnalyticsFile, runQuery, main } from "../tools/pull-posthog.mjs";
import { formatEvidence, fillEvidence, NOT_MEASURED } from "../docs/analytics-box.js";

const KEY = "phx_FAKE_TEST_KEY_123456";
const ENV = `OPENROUTER_API_KEY=x\nPOSTHOG_PERSONAL_API_KEY=${KEY}\nPOSTHOG_PROJECT_ID=12345\n`;

// A fake PostHog: answers by looking at the query text and the app_mode inside it.
function fakeFetch(calls = []) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body });
    const q = body.query.query, live = q.includes("'live'");
    let results;
    if (q.includes("GROUP BY event")) results = live ? [["session_started", 10, 4], ["debrief_viewed", 6, 3]] : [["session_started", 3, 3]];
    else if (q.includes("GROUP BY turns")) results = live ? [[2, 1], [4, 2], [6, 2], [8, 1]] : [];
    else results = live ? [[9.26, 6]] : [[null, 0]];
    return { ok: true, status: 200, text: async () => JSON.stringify({ results, columns: [] }) };
  };
}

test("readSettings reads both values and refuses empty ones without echoing the key", () => {
  assert.deepEqual(readSettings(ENV), { key: KEY, projectId: "12345" });
  assert.throws(() => readSettings("POSTHOG_PERSONAL_API_KEY=\nPOSTHOG_PROJECT_ID=1"), /POSTHOG_PERSONAL_API_KEY/);
  assert.throws(() => readSettings(`POSTHOG_PERSONAL_API_KEY=${KEY}\nPOSTHOG_PROJECT_ID=abc`), e => /numeric/.test(e.message) && !e.message.includes(KEY));
});

test(".env.example has both PostHog names, empty", () => {
  const ex = fs.readFileSync(new URL("../.env.example", import.meta.url), "utf-8");
  assert.match(ex, /^POSTHOG_PERSONAL_API_KEY=$/m);
  assert.match(ex, /^POSTHOG_PROJECT_ID=$/m);
});

test("parseArgs and buildQueries", () => {
  assert.deepEqual(parseArgs([]), { days: 120, out: "docs/analytics.json" });
  assert.equal(parseArgs(["--days", "30"]).days, 30);
  assert.throws(() => parseArgs(["--days", "0"]));
  assert.throws(() => parseArgs(["--x", "1"]), /Unknown flag/);
  const q = buildQueries("demo", 30);
  assert.match(q.counts, /app_mode = 'demo'/);
  assert.match(q.counts, /INTERVAL 30 DAY/);
  assert.throws(() => buildQueries("x' OR 1=1 --", 30), /Unknown mode/);
  assert.throws(() => buildQueries("live", "1; DROP"), /whole number/);
});

test("medianFromHistogram", () => {
  assert.equal(medianFromHistogram([[2, 1], [4, 2], [6, 2], [8, 1]]), 5);
  assert.equal(medianFromHistogram([[3, 1], [5, 1], [9, 1]]), 5);
  assert.equal(medianFromHistogram([]), null);
  assert.equal(medianFromHistogram([["4", "3"]]), 4);
});

test("summarize: live numbers, completion rate and empty case", () => {
  const live = summarize({ counts: { results: [["session_started", 10, 4], ["debrief_viewed", 6, 3]] }, turns: { results: [[4, 2], [6, 2]] }, met: { results: [[9.26, 6]] } });
  assert.deepEqual(live, { sessions: 10, users: 4, debriefs: 6, completionRate: 60, medianTurns: 5, avgMet: 9.3 });
  const none = summarize({ counts: { results: [] }, turns: { results: [] }, met: { results: [[null, 0]] } });
  assert.deepEqual(none, { sessions: 0, users: 0, debriefs: 0, completionRate: null, medianTurns: null, avgMet: null });
  assert.throws(() => summarize({ counts: {}, turns: { results: [] }, met: { results: [] } }), /no results array/);
});

test("main with a mocked PostHog: right requests, aggregates only in the file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ph-"));
  const out = path.join(dir, "analytics.json");
  const calls = [];
  const file = await main(["--out", out], { fetchImpl: fakeFetch(calls), envText: ENV, now: new Date(2026, 10, 20) });
  assert.equal(calls.length, 6);
  assert.equal(calls[0].url, "https://us.posthog.com/api/projects/12345/query/");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(calls[0].body.query.kind, "HogQLQuery");
  const text = fs.readFileSync(out, "utf-8");
  assert.deepEqual(JSON.parse(text), file);
  assert.deepEqual(Object.keys(file), ["generated", "windowDays", "live", "demo"]);
  assert.equal(file.generated, "2026-11-20");
  assert.equal(file.live.sessions, 10);
  assert.equal(file.demo.avgMet, null);
  assert.equal(text.includes(KEY), false);
  assert.doesNotMatch(text, /person|distinct_id|uuid/i);
});

test("runQuery: a failed call gives a short error that never contains the key", async () => {
  const bad = async () => ({ ok: false, status: 403, text: async () => JSON.stringify({ detail: `bad key ${KEY}` }) });
  await assert.rejects(runQuery(bad, { key: KEY, projectId: "1" }, "select 1"), e => /HTTP 403/.test(e.message) && !e.message.includes(KEY));
  const html = async () => ({ ok: false, status: 502, text: async () => "<html>" });
  await assert.rejects(runQuery(html, { key: KEY, projectId: "1" }, "select 1"), /HTTP 502/);
});

test("buildAnalyticsFile pads the date", () => {
  assert.equal(buildAnalyticsFile({ live: {}, demo: {} }, 7, new Date(2026, 0, 5)).generated, "2026-01-05");
});

// ---- the box on docs/index.html ----

test("formatEvidence: full sentence", () => {
  const data = { generated: "2026-11-20", live: { sessions: 10, debriefs: 6, avgMet: 9.3 } };
  assert.equal(formatEvidence(data), "10 live sessions, 6 finished a debrief, average 9.3 of 15 on the rubric, as of 2026-11-20");
});

test("formatEvidence: singular, no average yet, missing date", () => {
  assert.equal(formatEvidence({ generated: "2026-11-20", live: { sessions: 1, debriefs: 0, avgMet: null } }), "1 live session, 0 finished a debrief, as of 2026-11-20");
  assert.equal(formatEvidence({ live: { sessions: 2, debriefs: 1, avgMet: 12 } }), "2 live sessions, 1 finished a debrief, average 12 of 15 on the rubric");
});

test("formatEvidence: nothing measured falls back", () => {
  for (const d of [null, undefined, {}, { live: null }, { live: { sessions: 0 } }, { live: { sessions: "x" } }]) assert.equal(formatEvidence(d), NOT_MEASURED);
});

test("fillEvidence: fills the box, and leaves it alone when the file is missing or broken", async () => {
  const real = globalThis.fetch;
  try {
    const el = { textContent: "[Not yet measured]" };
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ generated: "2026-11-20", live: { sessions: 3, debriefs: 2, avgMet: 8 } }) });
    await fillEvidence(el);
    assert.equal(el.textContent, "3 live sessions, 2 finished a debrief, average 8 of 15 on the rubric, as of 2026-11-20");
    const el2 = { textContent: "[Not yet measured]" };
    globalThis.fetch = async () => ({ ok: false, status: 404 });
    await fillEvidence(el2);
    globalThis.fetch = async () => { throw new Error("offline"); };
    await fillEvidence(el2);
    globalThis.fetch = async () => ({ ok: true, json: async () => { throw new Error("bad json"); } });
    await fillEvidence(el2);
    assert.equal(el2.textContent, "[Not yet measured]");
  } finally { globalThis.fetch = real; }
});

test("docs/index.html has the box id and loads the script", () => {
  const html = fs.readFileSync(new URL("../docs/index.html", import.meta.url), "utf-8");
  assert.match(html, /id="user-evidence"/);
  assert.match(html, /import \{ fillEvidence \} from "\.\/analytics-box\.js"/);
});

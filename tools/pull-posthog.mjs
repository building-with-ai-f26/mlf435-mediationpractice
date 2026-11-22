// Pulls aggregate analytics from PostHog and writes docs/analytics.json (no person IDs, no event rows).
// Usage: node tools/pull-posthog.mjs [--days 120] [--out docs/analytics.json]
// Needs POSTHOG_PERSONAL_API_KEY (a personal key with "query:read") and POSTHOG_PROJECT_ID in .env.
// Reads events the app sends (see public/app.js): session_started, session_ended { turns }, debrief_viewed { met, graders_ok }.
// app_mode ('live', 'mock' or 'demo') is registered on every event by app.js.
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

export const POSTHOG_HOST = "https://us.posthog.com";
export const MODES = ["live", "demo"];

// ---------- pure helpers (tested) ----------

export function parseArgs(argv) {
  const a = { days: 120, out: "docs/analytics.json" };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i], v = argv[++i];
    if (v === undefined) throw new Error(`Missing value for ${f}`);
    if (f === "--days") a.days = Number(v);
    else if (f === "--out") a.out = v;
    else throw new Error(`Unknown flag ${f}`);
  }
  if (!Number.isInteger(a.days) || a.days < 1 || a.days > 3650) throw new Error("--days must be a whole number from 1 to 3650");
  return a;
}

// Reads the two settings from the text of a .env file. Throws a message that never includes the key.
export function readSettings(envText) {
  const get = name => (String(envText).match(new RegExp(`^${name}=(.*)$`, "m")) || [])[1]?.trim() || "";
  const key = get("POSTHOG_PERSONAL_API_KEY"), projectId = get("POSTHOG_PROJECT_ID");
  if (!key) throw new Error("POSTHOG_PERSONAL_API_KEY is empty or missing in .env");
  if (!/^\d+$/.test(projectId)) throw new Error("POSTHOG_PROJECT_ID must be the numeric project id in .env");
  return { key, projectId };
}

// Three small queries per mode. mode and days are checked here, never taken from free text.
export function buildQueries(mode, days) {
  if (!MODES.includes(mode)) throw new Error(`Unknown mode ${mode}`);
  if (!Number.isInteger(days)) throw new Error("days must be a whole number");
  const where = `properties.app_mode = '${mode}' AND timestamp > now() - INTERVAL ${days} DAY`;
  return {
    counts: `SELECT event, count() AS n, count(DISTINCT person_id) AS people FROM events WHERE event IN ('session_started', 'debrief_viewed') AND ${where} GROUP BY event`,
    turns: `SELECT toInt(properties.turns) AS turns, count() AS n FROM events WHERE event = 'session_ended' AND ${where} GROUP BY turns ORDER BY turns`,
    met: `SELECT avg(toFloat(properties.met)) AS avg_met, count() AS n FROM events WHERE event = 'debrief_viewed' AND toFloat(properties.graders_ok) > 0 AND ${where}`,
  };
}

const num = v => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
const rowsOf = res => {
  if (!res || !Array.isArray(res.results)) throw new Error("Unexpected PostHog response: no results array");
  return res.results;
};
const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;

// Median of a histogram [[value, count], ...]. null when empty.
export function medianFromHistogram(rows) {
  const h = rows.map(r => [num(r[0]), num(r[1])]).filter(([v, n]) => Number.isFinite(v) && Number.isFinite(n) && n > 0).sort((a, b) => a[0] - b[0]);
  const total = h.reduce((s, [, n]) => s + n, 0);
  if (!total) return null;
  const at = k => { let seen = 0; for (const [v, n] of h) { seen += n; if (seen > k) return v; } };
  return total % 2 ? at((total - 1) / 2) : (at(total / 2 - 1) + at(total / 2)) / 2;
}

// Turns the three responses into the numbers saved in analytics.json.
export function summarize({ counts, turns, met }) {
  const byEvent = Object.fromEntries(rowsOf(counts).map(r => [r[0], { n: num(r[1]) || 0, people: num(r[2]) || 0 }]));
  const sessions = byEvent.session_started?.n || 0;
  const debriefs = byEvent.debrief_viewed?.n || 0;
  const [avg, n] = rowsOf(met)[0] || [];
  const avgMet = num(n) > 0 && Number.isFinite(num(avg)) ? round(num(avg), 1) : null;
  return {
    sessions,
    users: byEvent.session_started?.people || 0,
    debriefs,
    completionRate: sessions > 0 ? round(Math.min(debriefs / sessions, 1) * 100, 1) : null,
    medianTurns: medianFromHistogram(rowsOf(turns)),
    avgMet,
  };
}

// ---------- network ----------

export async function runQuery(fetchImpl, { key, projectId }, hogql) {
  const res = await fetchImpl(`${POSTHOG_HOST}/api/projects/${projectId}/query/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query: hogql } }),
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  if (!res.ok || !data) {
    // Show PostHog's own message when there is one, never the key or the raw body.
    const detail = typeof data?.detail === "string" ? data.detail : "";
    throw new Error(`PostHog query failed (HTTP ${res.status})${detail ? `: ${detail.split(key).join("[redacted]")}` : ""}`);
  }
  return data;
}

export async function pullAll(fetchImpl, settings, days) {
  const out = {};
  for (const mode of MODES) {
    const q = buildQueries(mode, days);
    const [counts, turns, met] = [await runQuery(fetchImpl, settings, q.counts), await runQuery(fetchImpl, settings, q.turns), await runQuery(fetchImpl, settings, q.met)];
    out[mode] = summarize({ counts, turns, met });
  }
  return out;
}

// The only thing written to disk: aggregates and a date.
export function buildAnalyticsFile(stats, days, now = new Date()) {
  const pad = n => String(n).padStart(2, "0");
  return { generated: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, windowDays: days, live: stats.live, demo: stats.demo };
}

export async function main(argv, { fetchImpl = fetch, envText, now = new Date() } = {}) {
  const args = parseArgs(argv);
  const settings = readSettings(envText ?? (fs.existsSync(".env") ? fs.readFileSync(".env", "utf-8") : ""));
  const file = buildAnalyticsFile(await pullAll(fetchImpl, settings, args.days), args.days, now);
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(file, null, 2) + "\n");
  console.log(`Wrote ${args.out}: live ${file.live.sessions} sessions, ${file.live.debriefs} debriefs; demo ${file.demo.sessions} sessions (last ${args.days} days).`);
  return file;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exit(1); });
}

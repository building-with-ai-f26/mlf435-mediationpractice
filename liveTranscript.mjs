// POST /api/transcript: checks and saves one live session. Imported by server.mjs and tests.
// Files go to <baseDir>/YYYY-MM-DD/HHMMSS-<topic>-<difficulty>.json plus a row in <baseDir>/index.csv.
import fs from "fs";
import path from "path";

export const MAX_TRANSCRIPT_BYTES = 200 * 1024;
export const INDEX_HEADER = "date,file,scenario,difficulty,ra_turns,partial,met,score_pct,deepseek_met,claude_met,gemini_met";

// Only these top-level fields are kept. Anything else the browser sends is dropped.
const KEEP = ["schemaVersion", "createdAt", "scenario", "difficulty", "partial", "models", "rubricVersion", "openness", "routing", "transcript", "graders", "combined", "result", "usage"];

const pad = n => String(n).padStart(2, "0");
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const localDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const csv = v => (v === null || v === undefined ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

// Relative path: YYYY-MM-DD/HHMMSS-<topic>-<difficulty>.json
export function livePath(date, topic, difficulty) {
  const t = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${localDate(date)}/${t}-${slug(topic)}-${slug(difficulty)}.json`;
}

// Returns { record } or { error, status }. rawText is the request body as text.
// gitCommit comes from the server, never from the browser.
export function validateTranscript(rawText, { key, gitCommit = "unknown" } = {}) {
  if (Buffer.byteLength(rawText, "utf-8") > MAX_TRANSCRIPT_BYTES) return { status: 413, error: "Transcript too large" };
  if (rawText.includes("sk-or-") || (key && key.length > 8 && rawText.includes(key))) {
    return { status: 400, error: "Refused: the content looks like it contains an API key" };
  }
  let input;
  try { input = JSON.parse(rawText); } catch { return { status: 400, error: "Invalid JSON" }; }
  if (!input || typeof input !== "object" || Array.isArray(input)) return { status: 400, error: "Invalid transcript" };
  if (typeof input.scenario !== "string" || !slug(input.scenario)) return { status: 400, error: "scenario is required" };
  if (typeof input.difficulty !== "string" || !slug(input.difficulty)) return { status: 400, error: "difficulty is required" };
  if (!Array.isArray(input.transcript) || input.transcript.length === 0) return { status: 400, error: "transcript must be a non-empty array" };
  if (!input.transcript.every(t => t && typeof t.text === "string" && typeof t.sender === "string")) return { status: 400, error: "Each transcript line needs sender and text" };
  const record = {};
  for (const k of KEEP) if (input[k] !== undefined) record[k] = input[k];
  record.schemaVersion = 1;
  record.source = "live";
  record.gitCommit = gitCommit;
  record.persona = { id: "live" };
  return { record };
}

export function indexLine(rec, file) {
  const byName = Object.fromEntries((rec.graders || []).map(g => [g.name, g]));
  const met = n => (byName[n]?.ok ? byName[n].metCount : null);
  const raTurns = rec.transcript.filter(t => t.role === "ra").length;
  return [localDate(new Date(rec.createdAt || Date.now())), file, rec.scenario, rec.difficulty, raTurns, rec.partial ? "yes" : "no",
    rec.result?.met ?? null, rec.result?.score ?? null, met("DeepSeek"), met("Claude"), met("Gemini")].map(csv).join(",");
}

// Writes the file and appends the index row. Returns the path relative to baseDir.
export function saveTranscript(record, baseDir, now = new Date()) {
  const rel = livePath(now, record.scenario, record.difficulty);
  let file = path.join(baseDir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let n = 2; fs.existsSync(file); n++) file = path.join(baseDir, rel.replace(/\.json$/, `-${n}.json`));
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
  const idx = path.join(baseDir, "index.csv");
  fs.appendFileSync(idx, (fs.existsSync(idx) ? "" : INDEX_HEADER + "\n") + indexLine(record, path.relative(baseDir, file)) + "\n");
  return path.relative(baseDir, file);
}

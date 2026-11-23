// Usage: node tools/zdrcheck.mjs [extra/model-id ...]
// Lists which models have a zero data retention route, then sends one tiny real request per model
// through the same code path the server uses (sendToOpenRouter). Real calls, billed to your key.
import fs from "node:fs";
import { MAIN_MODEL, GRADER_MODELS, TAGGER_MODEL, ROUTER_MODEL } from "../public/config.js";
import { sendToOpenRouter } from "../chatBody.mjs";
import { readSetting } from "../auth.mjs";

const key = readSetting("OPENROUTER_API_KEY", process.env, new URL("../.env", import.meta.url).pathname);
if (!key) { console.error("OPENROUTER_API_KEY not found"); process.exit(1); }

const ids = [...new Set([MAIN_MODEL, ...GRADER_MODELS.map(g => g.id), TAGGER_MODEL, ROUTER_MODEL, ...process.argv.slice(2)])];

let listed = null;
try {
  const r = await fetch("https://openrouter.ai/api/v1/endpoints/zdr", { signal: AbortSignal.timeout(30000) });
  const j = await r.json();
  const rows = Array.isArray(j.data) ? j.data : [];
  listed = new Set(rows.map(e => e.model_id || e.model || (e.name && e.name.split(": ").pop()) || "").filter(Boolean));
  // endpoints may also be keyed by name like "provider | model"; keep raw strings for substring match
  listed.raw = rows.map(e => JSON.stringify(e));
} catch (e) { console.error("ZDR list fetch failed:", e.message); }

const inList = id => listed ? (listed.has(id) || listed.raw.some(s => s.includes(`"${id}"`))) : null;

const out = [];
for (const id of ids) {
  let status;
  try {
    const r = await sendToOpenRouter(
      { model: id, messages: [{ role: "user", content: "Say hi." }], max_tokens: 20 },
      { key, referer: "http://localhost:3000" });
    status = r.ok ? "ok" : (r.data?.error?.message || `HTTP ${r.status}`);
  } catch (e) { status = e.message; }
  out.push({ model: id, zdr_listed: inList(id) === null ? "?" : inList(id) ? "yes" : "no", request: status });
}
console.table(out);

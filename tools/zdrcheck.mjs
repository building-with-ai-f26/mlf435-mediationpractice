// Usage: node tools/zdrcheck.mjs [--max-cost 0.05] [extra/model-id ...]
// Fetches OpenRouter's zero data retention list, then sends ONE tiny real request per model id (20 token reply, reasoning off as in the app)
// through the same code the server uses (buildRequestBody, validateChatBody, sendToOpenRouter, which adds provider zdr true and
// data_collection deny). Prints model, listed as zero retention, and request ok or the error. Real calls, billed to your key, stopped at --max-cost.
// A "no endpoints" error means the model has no zero retention route. Nothing falls back to another model.
import path from "node:path";
import { RESIDENT_MODEL, GRADER_MODELS, TAGGER_MODEL, ROUTER_MODEL, REASONING } from "../public/config.js";
import { buildRequestBody } from "../public/logic.js";
import { validateChatBody, sendToOpenRouter, zdrRefusalMessage, zdrEnabled } from "../chatBody.mjs";
import { readSetting } from "../auth.mjs";

export function parseArgs(argv) {
  const a = { maxCost: 0.05, extra: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--max-cost") { a.maxCost = Number(argv[++i]); if (!Number.isFinite(a.maxCost) || a.maxCost < 0) throw new Error("--max-cost must be a number of dollars"); }
    else if (argv[i].startsWith("--")) throw new Error(`Unknown flag ${argv[i]}`);
    else a.extra.push(argv[i]);
  }
  return a;
}

// Does any endpoint on the ZDR list belong to this model id? rows are the list's data array.
export function isListed(rows, id) {
  return rows.some(e => e.model_id === id);
}

// One tiny request. send(clean) -> { ok, status, data }. Returns { request: "ok" | message, usd }.
export async function checkModel(id, send) {
  const { clean, error } = validateChatBody(buildRequestBody(id, [{ role: "user", content: "Say hi." }], { maxTokens: 20, reasoning: REASONING }), new Set([id]));
  if (error) return { request: error, usd: null };
  try {
    const r = await send(clean);
    if (r.ok && !r.data?.error) return { request: "ok", usd: typeof r.data?.usage?.cost === "number" ? r.data.usage.cost : null };
    const msg = r.data?.error?.message || `HTTP ${r.status}`;
    return { request: zdrRefusalMessage(id, msg) ? `NO ZERO RETENTION ROUTE (${msg.slice(0, 60)})` : msg, usd: null };
  } catch (e) { return { request: e.message, usd: null }; }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const key = readSetting("OPENROUTER_API_KEY", process.env, path.resolve(".env"));
  if (!key) { console.error("OPENROUTER_API_KEY not found in the environment or .env"); process.exit(1); }
  const ids = [...new Set([RESIDENT_MODEL, ...GRADER_MODELS.map(g => g.id), TAGGER_MODEL, ROUTER_MODEL, ...args.extra])];
  let rows = null;
  try {
    const r = await fetch("https://openrouter.ai/api/v1/endpoints/zdr", { signal: AbortSignal.timeout(30000) });
    rows = (await r.json()).data;
    if (!Array.isArray(rows)) rows = null;
  } catch (e) { console.error("ZDR list fetch failed:", e.message); }
  console.log(`zero data retention flag: ${zdrEnabled() ? "ON" : "OFF (OPENROUTER_ZDR)"}, max cost $${args.maxCost.toFixed(2)}`);
  const send = clean => sendToOpenRouter(clean, { key, referer: "http://localhost:3000" });
  const out = []; let spent = 0;
  for (const id of ids) {
    const listed = rows ? (isListed(rows, id) ? "yes" : "no") : "?";
    if (spent > args.maxCost) { out.push({ model: id, zdr_listed: listed, request: "skipped: --max-cost reached" }); continue; }
    const c = await checkModel(id, send);
    if (c.usd !== null) spent += c.usd;
    out.push({ model: id, zdr_listed: listed, request: c.request });
  }
  console.table(out);
  console.log(`Spend: $${spent.toFixed(4)} known.`);
}

import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message); process.exit(1); });

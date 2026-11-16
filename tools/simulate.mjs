// Runs simulated RA sessions end to end against OpenRouter (never the local server) and saves transcripts.
// Usage: node tools/simulate.mjs --persona strong --runs 1 [--dry] [--scenario noise] [--difficulty medium]
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { pathToFileURL } from "url";
import { PERSONAS } from "./personas.mjs";
import { MAIN_MODEL, GRADER_MODELS, GRADER_OPTS, TOKENS_RESIDENT, TAGGER_MODEL, TAGGER_OPTS, MAX_TURNS, getProfiles, alexPrompt, jordanPrompt, createSession } from "../public/config.js";
import { getResponder, commitTurn, mediationPrompt, buildTaggerPrompt, parseTags, updateOpenness, startingOpenness, buildRequestBody, cleanResponse, isTurnCapReached } from "../public/logic.js";
import { RUBRIC, RUBRIC_VERSION, buildRubricPrompt, parseRubricReply, verifyEvidence, combineGraders, scoreFromCombined } from "../public/rubric.js";
import { mockResponse } from "../public/mock.js";

export const SCHEMA_VERSION = 1;
export const SCENARIOS = ["noise", "cleaning", "guest policy", "hygiene", "shared items", "religious practice"];
export const DIFFICULTIES = ["easy", "medium", "hard"];
export const RA_NAME = "Sam";
const RA_OPTS = { maxTokens: 200, temperature: 0.9 };
const ROLES = ["residents", "ra_sim", "graders", "tagger"];
const CSV_COST_ROLES = ["residents", "ra_sim", "graders"];

export class BudgetError extends Error {}

// ---------- pure helpers (tested) ----------

export function parseArgs(argv) {
  const a = { scenario: "noise", difficulty: "medium", persona: "all", runs: 1, maxTurns: 8, raModel: "deepseek/deepseek-chat", maxCost: 1.0, out: "transcripts", outGiven: false, dry: false };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i];
    if (f === "--dry") { a.dry = true; continue; }
    const v = argv[++i];
    if (v === undefined) throw new Error(`Missing value for ${f}`);
    if (f === "--scenario") a.scenario = v;
    else if (f === "--difficulty") a.difficulty = v;
    else if (f === "--persona") a.persona = v;
    else if (f === "--runs") a.runs = Number(v);
    else if (f === "--max-turns") a.maxTurns = Number(v);
    else if (f === "--ra-model") a.raModel = v;
    else if (f === "--max-cost") a.maxCost = Number(v);
    else if (f === "--out") { a.out = v; a.outGiven = true; }
    else throw new Error(`Unknown flag ${f}`);
  }
  if (!SCENARIOS.includes(a.scenario)) throw new Error(`--scenario must be one of: ${SCENARIOS.join(", ")}`);
  if (!DIFFICULTIES.includes(a.difficulty)) throw new Error(`--difficulty must be one of: ${DIFFICULTIES.join(", ")}`);
  if (a.persona !== "all" && !PERSONAS.some(p => p.id === a.persona)) throw new Error(`--persona must be "all" or one of: ${PERSONAS.map(p => p.id).join(", ")}`);
  if (!Number.isInteger(a.runs) || a.runs < 1) throw new Error("--runs must be a whole number of at least 1");
  if (!Number.isInteger(a.maxTurns) || a.maxTurns < 1) throw new Error("--max-turns must be a whole number of at least 1");
  if (!Number.isFinite(a.maxCost) || a.maxCost < 0) throw new Error("--max-cost must be a number of dollars");
  return a;
}

const pad = n => String(n).padStart(2, "0");
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const localDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Relative path: YYYY-MM-DD/HHMMSS-<scenario>-<difficulty>-<persona>.json
export function transcriptPath(date, scenario, difficulty, personaId) {
  const t = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${localDate(date)}/${t}-${slug(scenario)}-${slug(difficulty)}-${slug(personaId)}.json`;
}

export const INDEX_HEADER = ["date", "file", "scenario", "difficulty", "persona", "met", "score_pct", ...GRADER_MODELS.map(g => `${g.name.toLowerCase()}_met`), "cost_residents", "cost_ra_sim", "cost_graders"].join(",");
const csv = v => (v === null || v === undefined ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

export function indexLine(rec, file) {
  const byName = Object.fromEntries(rec.graders.map(g => [g.name, g]));
  const cells = [
    localDate(new Date(rec.createdAt)), file, rec.scenario, rec.difficulty, rec.persona.id,
    rec.result.met, rec.result.score,
    ...GRADER_MODELS.map(g => (byName[g.name]?.ok ? byName[g.name].metCount : null)),
    ...CSV_COST_ROLES.map(r => rec.cost[r].usd),
  ];
  return cells.map(csv).join(",");
}

// Refuse to write anything that looks like an OpenRouter key (or the loaded key itself).
export function assertNoSecret(text, key) {
  if (String(text).includes("sk-or-") || (key && key.length > 8 && String(text).includes(key))) {
    throw new Error("Refusing to write: the text contains something that looks like an API key (sk-or-).");
  }
}

export function safeWrite(file, text, { append = false, key } = {}) {
  assertNoSecret(text, key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  (append ? fs.appendFileSync : fs.writeFileSync)(file, text);
}

// Cost of one call in USD, or null if unknown. Prefer the API's own number, then prices.json.
export function costOf(model, usage, prices = {}) {
  if (typeof usage?.cost === "number") return usage.cost;
  const p = prices[model];
  if (p && typeof p.prompt_per_million === "number" && typeof p.completion_per_million === "number" && usage) {
    return ((usage.prompt_tokens || 0) * p.prompt_per_million + (usage.completion_tokens || 0) * p.completion_per_million) / 1e6;
  }
  return null;
}

export function newLedger() {
  return Object.fromEntries(ROLES.map(r => [r, { calls: 0, prompt_tokens: 0, completion_tokens: 0, reasoning_tokens: 0, usd: 0, known: true }]));
}

export function addToLedger(ledger, role, usage, usd) {
  const l = ledger[role];
  l.calls += 1;
  l.prompt_tokens += usage?.prompt_tokens || 0;
  l.completion_tokens += usage?.completion_tokens || 0;
  l.reasoning_tokens += usage?.completion_tokens_details?.reasoning_tokens || 0;
  if (usd === null) l.known = false; else l.usd += usd;
}

// Shapes the ledger into the usage and cost blocks saved in the transcript file.
export function summarizeLedger(ledger) {
  const usage = {}, cost = {};
  for (const r of ROLES) {
    const { usd, known, ...tokens } = ledger[r];
    usage[r] = tokens;
    cost[r] = { usd: known ? usd : null, known };
  }
  const sum = roles => {
    const known = roles.every(r => cost[r].known);
    return { usd: known ? roles.reduce((s, r) => s + cost[r].usd, 0) : null, known };
  };
  cost.user_session = sum(["residents", "tagger", "graders"]);
  cost.total = sum(ROLES);
  return { usage, cost };
}

// ---------- one simulated session ----------

const label = s => (s === RA_NAME ? "RA" : s);

// deps: { call({role, model, messages, opts, meta}) -> {content, finishReason, usage}, prices, now(), before(), after(usd) }
export async function runOne({ scenario, difficulty, persona, raModel, maxTurnsFallback = 8, gitCommit = "unknown" }, deps) {
  const ledger = newLedger();
  const track = async (role, model, messages, opts, meta) => {
    deps.before?.();
    const r = await deps.call({ role, model, messages, opts, meta });
    const usd = costOf(model, r.usage, deps.prices);
    addToLedger(ledger, role, r.usage, usd);
    if (usd !== null) deps.after?.(usd);
    return r;
  };
  const resident = async prompt => {
    const r = await track("residents", MAIN_MODEL, [{ role: "system", content: prompt }], { maxTokens: TOKENS_RESIDENT });
    if (!r.content) throw new Error(`Empty resident reply (finish_reason: ${r.finishReason})`);
    return cleanResponse(r.content);
  };

  const session = createSession();
  session.raName = RA_NAME; session.topic = scenario; session.difficulty = difficulty; session.active = true;
  const profiles = getProfiles(scenario, difficulty);
  session.profiles = profiles;
  session.openness = startingOpenness(difficulty);
  const openStart = { alex: session.openness.alex, jordan: session.openness.jordan };
  const turnLog = [];
  const stamps = [];
  const add = (sender, text) => { session.turnHistory.push({ sender, text }); stamps.push(deps.now().toISOString()); };

  const alexText = await resident(alexPrompt(scenario, difficulty, profiles));
  add("Alex", alexText);
  add("Jordan", await resident(jordanPrompt(scenario, difficulty, profiles, alexText)));
  session.lastSpeaker = "Jordan";

  const maxTurns = Math.min(persona.maxTurns ?? maxTurnsFallback, MAX_TURNS);
  for (let k = 1; k <= maxTurns && !isTurnCapReached(session.turnCount, MAX_TURNS); k++) {
    const shown = session.turnHistory.map(h => `${label(h.sender)}: ${h.text}`).join("\n");
    const ask = `Conversation so far:\n${shown}\n\nYou are writing RA message ${k} of ${maxTurns}. Write only that message.`;
    const r = await track("ra_sim", raModel, [{ role: "system", content: persona.systemPrompt }, { role: "user", content: ask }], RA_OPTS, { personaId: persona.id, k });
    const text = r.content.replace(/^\s*(RA|Sam)\s*:\s*/i, "").replace(/^"(.*)"$/s, "$1").trim();
    if (!text) throw new Error(`Empty RA message (finish_reason: ${r.finishReason})`);
    const raEntry = { sender: RA_NAME, text };
    const speaker = getResponder(text, session.lastSpeaker);
    // Tagger: an unreadable or failed reply leaves openness unchanged, same as the app.
    let tags = null;
    try {
      const t = await track("tagger", TAGGER_MODEL, [{ role: "system", content: buildTaggerPrompt(session.turnHistory, text) }], TAGGER_OPTS);
      tags = parseTags(t.content);
    } catch (e) {
      if (e instanceof BudgetError) throw e;
    }
    const before = { alex: session.openness.alex, jordan: session.openness.jordan };
    const openness = updateOpenness(session.openness, tags, difficulty);
    const reply = await resident(mediationPrompt(scenario, difficulty, [...session.turnHistory, raEntry], speaker, k, profiles, openness[speaker.toLowerCase()]));
    session.openness = openness;
    turnLog.push({ turn: k, speaker, tags, openness_before: before, openness_after: { alex: openness.alex, jordan: openness.jordan } });
    stamps.push(deps.now().toISOString(), deps.now().toISOString());
    commitTurn(session, raEntry, speaker, reply);
  }

  // Graders, in parallel, exactly as the app does.
  const prompt = buildRubricPrompt(scenario, difficulty, session.turnHistory, RA_NAME);
  const graders = await Promise.all(GRADER_MODELS.map(async g => {
    const rec = { name: g.name, model: g.id, ok: false, raw: "", finishReason: null, answers: {}, changed: [], metCount: null };
    try {
      const r = await track("graders", g.id, [{ role: "system", content: prompt }], GRADER_OPTS);
      rec.raw = r.content; rec.finishReason = r.finishReason;
      const parsed = parseRubricReply(r.content);
      if (!parsed.ok) throw new Error("the reply could not be read as 15 yes/no lines");
      const v = verifyEvidence(parsed.answers, session.turnHistory);
      rec.ok = true; rec.answers = v.answers; rec.changed = v.changed;
      rec.metCount = Object.values(v.answers).filter(a => a.yes).length;
    } catch (e) {
      if (e instanceof BudgetError) throw e;
      rec.error = e.message;
    }
    return rec;
  }));

  const combined = combineGraders(graders);
  const anyValid = graders.some(g => g.ok);
  const result = anyValid ? scoreFromCombined(combined) : { met: null, total: RUBRIC.length, score: null };
  const { usage, cost } = summarizeLedger(ledger);
  return {
    schemaVersion: SCHEMA_VERSION, createdAt: deps.now().toISOString(), gitCommit,
    scenario, difficulty,
    persona: { id: persona.id, category: persona.category, expected: persona.expected, maxTurns },
    models: { resident: MAIN_MODEL, ra_sim: raModel, graders: GRADER_MODELS.map(g => g.id) },
    rubricVersion: RUBRIC_VERSION,
    openness: { start: openStart, turns: turnLog },
    transcript: session.turnHistory.map((h, i) => ({ sender: h.sender, text: h.text, at: stamps[i] })),
    graders, combined, result, usage, cost,
  };
}

// ---------- real and dry model calls ----------

const redact = (s, key) => String(s).replace(/sk-or-[\w-]+/g, "[redacted]").split(key || "\u0000").join("[redacted]");

export function makeApiCall(key) {
  return async ({ model, messages, opts }) => {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "RA Practice Scenarios (tools)" },
      body: JSON.stringify(buildRequestBody(model, messages, opts)),
      signal: AbortSignal.timeout(90000),
    });
    const text = await res.text();
    let d = null; try { d = JSON.parse(text); } catch {}
    if (!res.ok || !d || d.error) throw new Error(redact(`${model} HTTP ${res.status}: ${d?.error?.message || text.slice(0, 300)}`, key));
    const c = d.choices?.[0];
    return { content: typeof c?.message?.content === "string" ? c.message.content.trim() : "", finishReason: c?.finish_reason ?? null, usage: d.usage };
  };
}

const DRY_RA = [
  "Thanks for coming, both of you will get a turn to speak. Let's keep it to one person at a time.",
  "Alex, can you tell me what has been going on for you?",
  "It sounds like you are exhausted, Alex. Jordan, what is your side of it?",
  "What would help you both feel comfortable in the room?",
  "What could each of you try this week?",
  "Let's agree on a quiet time and check in next Friday.",
];

export async function dryCall({ role, model, messages, meta }) {
  if (role === "ra_sim") return { content: meta.personaId === "minimal" ? "ok" : DRY_RA[(meta.k - 1) % DRY_RA.length], finishReason: "stop", usage: { prompt_tokens: 0, completion_tokens: 0, cost: 0 } };
  const data = mockResponse(model, messages);
  return { content: data.choices[0].message.content, finishReason: "stop", usage: { ...data.usage, cost: 0 } };
}

// ---------- CLI ----------

function loadKey() {
  const m = fs.existsSync(".env") && fs.readFileSync(".env", "utf-8").match(/^OPENROUTER_API_KEY=(.+)$/m);
  return m ? m[1].trim() : "";
}
const gitShort = () => { try { return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return "unknown"; } };
const usd = c => (c.usd === null ? "unknown" : `$${c.usd.toFixed(4)}`);
const clip = (s, n = 90) => (s.length > n ? s.slice(0, n - 3) + "..." : s).replace(/\n+/g, " ");

export async function main(argv) {
  const args = parseArgs(argv);
  const key = args.dry ? "" : loadKey();
  if (!args.dry && !key) { console.error("OPENROUTER_API_KEY not found in .env (use --dry to run without it)."); process.exit(1); }
  const prices = JSON.parse(fs.readFileSync(new URL("./prices.json", import.meta.url), "utf-8"));
  const personas = args.persona === "all" ? PERSONAS : PERSONAS.filter(p => p.id === args.persona);
  const gitCommit = gitShort();
  const budget = { total: 0 };
  let unknownCostWarned = false, saved = 0, failed = 0;
  const deps = {
    call: args.dry ? dryCall : makeApiCall(key), prices, now: () => new Date(),
    before() { if (budget.total > args.maxCost) throw new BudgetError(`Running cost $${budget.total.toFixed(4)} is over --max-cost $${args.maxCost.toFixed(2)}`); },
    after(c) { budget.total += c; },
  };
  const write = !args.dry || args.outGiven;
  console.log(`${args.dry ? "DRY RUN (no network). " : ""}${personas.length} persona(s) x ${args.runs} run(s), ${args.scenario}/${args.difficulty}, max cost $${args.maxCost.toFixed(2)}`);

  try {
    for (const persona of personas) for (let run = 1; run <= args.runs; run++) {
      let rec;
      try {
        rec = await runOne({ scenario: args.scenario, difficulty: args.difficulty, persona, raModel: args.raModel, maxTurnsFallback: args.maxTurns, gitCommit }, deps);
      } catch (e) {
        if (e instanceof BudgetError) throw e;
        failed++; console.error(`[${persona.id} #${run}] FAILED: ${redact(e.message, key)}`); continue;
      }
      if (args.dry) rec.dry = true;
      for (const t of rec.transcript.slice(2)) console.log(`  ${t.sender.padEnd(7)} ${clip(t.text)}`);
      const exp = persona.expected ? `${persona.expected.min} to ${persona.expected.max}` : "none";
      const flag = persona.expected && rec.result.met !== null ? (rec.result.met >= persona.expected.min && rec.result.met <= persona.expected.max ? "in range" : "OUT OF RANGE") : "";
      console.log(`[${persona.id} #${run}] ${rec.result.met ?? "n/a"} of 15 (${rec.result.score ?? "n/a"}%), expected ${exp} ${flag} | graders ${rec.graders.map(g => `${g.name} ${g.ok ? g.metCount : "FAILED"}`).join(", ")} | changed ${rec.graders.reduce((n, g) => n + g.changed.length, 0)} | cost residents ${usd(rec.cost.residents)}, ra_sim ${usd(rec.cost.ra_sim)}, graders ${usd(rec.cost.graders)}`);
      for (const g of rec.graders.filter(g => !g.ok)) console.error(`  ${g.name}: ${redact(g.error, key)}`);
      if (!rec.cost.total.known && !unknownCostWarned) { unknownCostWarned = true; console.warn("  Note: some costs are unknown, so --max-cost cannot count them. Fill in tools/prices.json."); }
      const rel = transcriptPath(new Date(rec.createdAt), args.scenario, args.difficulty, persona.id);
      let file = path.join(args.out, rel);
      for (let n = 2; fs.existsSync(file); n++) file = path.join(args.out, rel.replace(/\.json$/, `-${n}.json`));
      if (write) {
        safeWrite(file, JSON.stringify(rec, null, 2) + "\n", { key });
        const idx = path.join(args.out, "index.csv");
        safeWrite(idx, (fs.existsSync(idx) ? "" : INDEX_HEADER + "\n") + indexLine(rec, path.relative(args.out, file)) + "\n", { append: true, key });
        saved++; console.log(`  saved ${file}`);
      } else console.log(`  (dry) would save ${file}`);
    }
  } catch (e) {
    if (!(e instanceof BudgetError)) throw e;
    console.error(`STOPPED: ${e.message}`);
  }
  console.log(`Done. ${saved} saved, ${failed} failed, known spend $${budget.total.toFixed(4)}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exit(1); });
}

// Checks the router, the tagger and the graders against labeled cases, per model.
// Usage: node tools/classifybench.mjs --task router|tagger|grader [--dir labeled/<task>] [--models a/b,c/d] [--max-cost 0.25] [--dry]
// Cases are JSON files in --dir (default labeled/<task>). Live runs send real, billed requests through the same
// zero data retention code path as the server. Models default to the ones the app uses for that task.
//   router : { task, id, history: [{sender,text}], message, correct: "ALEX"|"JORDAN"|"BOTH" }
//   tagger : { task, id, scenario?, difficulty?, history, message, correct: { addresses?, open_question?, ... } }  (only listed fields are checked)
//   grader : { task, id, scenario, difficulty, transcript: [{sender,text}] (RA lines use sender "RA"), correct: { "1": true, ..., "15": false } }  (scored by hand)
// Files with "example": true were written as examples, not by hand. The tool says so, so do not trust their numbers.
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { ROUTER_MODEL, TAGGER_MODEL, ROUTER_OPTS, TAGGER_OPTS, GRADER_MODELS, GRADER_OPTS, graderOpts, getProfiles } from "../public/config.js";
import { buildRouterPrompt, parseRouterReply, buildTaggerPrompt, parseTags, buildRequestBody } from "../public/logic.js";
import { RUBRIC, buildRubricPrompt, parseRubricReply, verifyEvidence } from "../public/rubric.js";
import { validateChatBody, sendToOpenRouter, zdrEnabled } from "../chatBody.mjs";
import { readSetting } from "../auth.mjs";
import { BudgetError, costOf } from "./simulate.mjs";

export const TASKS = ["router", "tagger", "grader"];

export function parseArgs(argv) {
  const a = { task: null, dir: null, models: null, maxCost: 0.25, dry: false };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i];
    if (f === "--dry") { a.dry = true; continue; }
    const v = argv[++i];
    if (v === undefined) throw new Error(`Missing value for ${f}`);
    if (f === "--task") a.task = v;
    else if (f === "--dir") a.dir = v;
    else if (f === "--models") a.models = v.split(",").map(x => x.trim()).filter(Boolean);
    else if (f === "--max-cost") a.maxCost = Number(v);
    else throw new Error(`Unknown flag ${f}`);
  }
  if (!TASKS.includes(a.task)) throw new Error(`--task must be one of: ${TASKS.join(", ")}`);
  if (!Number.isFinite(a.maxCost) || a.maxCost < 0) throw new Error("--max-cost must be a number of dollars");
  a.dir ||= `labeled/${a.task}`;
  a.models ||= a.task === "router" ? [ROUTER_MODEL] : a.task === "tagger" ? [TAGGER_MODEL] : GRADER_MODELS.map(g => g.id);
  return a;
}

export function loadCases(dir, task) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort();
  if (!files.length) throw new Error(`No .json files in ${dir}`);
  return files.map(f => {
    let c; try { c = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")); } catch (e) { throw new Error(`${f}: ${e.message}`); }
    const err = validateCase(c, task);
    if (err) throw new Error(`${f}: ${err}`);
    return c;
  });
}

export function validateCase(c, task) {
  if (!c || typeof c !== "object") return "not an object";
  if (c.task !== task) return `task must be "${task}"`;
  if (typeof c.id !== "string" || !c.id) return "id must be a non-empty string";
  const lines = v => Array.isArray(v) && v.every(t => t && typeof t.sender === "string" && typeof t.text === "string");
  if (task === "router") {
    if (!lines(c.history ?? [])) return "history must be an array of { sender, text }";
    if (typeof c.message !== "string" || !c.message) return "message must be a non-empty string";
    if (!["ALEX", "JORDAN", "BOTH"].includes(c.correct)) return 'correct must be "ALEX", "JORDAN" or "BOTH"';
  } else if (task === "tagger") {
    if (!lines(c.history ?? [])) return "history must be an array of { sender, text }";
    if (typeof c.message !== "string" || !c.message) return "message must be a non-empty string";
    if (!c.correct || typeof c.correct !== "object" || !Object.keys(c.correct).length) return "correct must list at least one tag";
  } else {
    if (!lines(c.transcript) || !c.transcript.some(t => t.sender === "RA")) return "transcript must be { sender, text } lines with some from RA";
    if (!c.correct || !RUBRIC.every(q => typeof c.correct[q.id] === "boolean")) return "correct must have true or false for each of Q1 to Q15";
  }
  return null;
}

// One case, one model. Returns { model, id, ok (usable reply), agree, detail, usage, usd }.
// deps: { send(cleanBody) -> {status, ok, data}, prices, charge(usd|null) }
export async function runCase(task, c, model, deps) {
  const allow = new Set([model]);
  let messages, opts;
  if (task === "router") { messages = [{ role: "system", content: buildRouterPrompt(c.history, c.message) }]; opts = ROUTER_OPTS; }
  else if (task === "tagger") { messages = [{ role: "system", content: buildTaggerPrompt(c.history, c.message, getProfiles(c.scenario || "noise", c.difficulty || "medium")) }]; opts = TAGGER_OPTS; }
  else {
    const g = GRADER_MODELS.find(x => x.id === model);
    messages = [{ role: "system", content: buildRubricPrompt(c.scenario, c.difficulty, c.transcript.map(t => ({ sender: t.sender === "RA" ? "RA" : t.sender, text: t.text })), "RA") }];
    opts = g ? graderOpts(g) : GRADER_OPTS;
  }
  const { clean, error } = validateChatBody(buildRequestBody(model, messages, opts), allow);
  if (error) throw new Error(error);
  deps.charge?.check();
  const r = await deps.send(clean);
  if (!r.ok || r.data?.error) return { model, id: c.id, ok: false, agree: null, detail: `HTTP ${r.status}: ${String(r.data?.error?.message || "request failed").slice(0, 120)}`, usage: {}, usd: null };
  const content = r.data.choices?.[0]?.message?.content ?? "";
  const usd = costOf(model, r.data.usage, deps.prices);
  deps.charge?.add(usd);
  const out = { model, id: c.id, usage: r.data.usage || {}, usd };
  if (task === "router") {
    const p = parseRouterReply(content, "Jordan");
    if (p.source !== "router") return { ...out, ok: false, agree: null, detail: `unusable reply ${JSON.stringify(String(content).slice(0, 40))}` };
    return { ...out, ok: true, agree: p.to.toUpperCase() === c.correct, detail: `${p.to.toUpperCase()} (correct ${c.correct})` };
  }
  if (task === "tagger") {
    const t = parseTags(content);
    if (!t) return { ...out, ok: false, agree: null, detail: "unusable reply" };
    const fields = Object.keys(c.correct).map(k => ({ field: k, match: t[k] === c.correct[k] }));
    return { ...out, ok: true, agree: fields.every(f => f.match), fields, detail: fields.filter(f => !f.match).map(f => f.field).join(", ") || "all fields match" };
  }
  const parsed = parseRubricReply(content);
  if (!parsed.ok) return { ...out, ok: false, agree: null, detail: "could not read 15 yes/no lines" };
  const v = verifyEvidence(parsed.answers, c.transcript.map(t => ({ sender: t.sender, text: t.text })));
  const questions = RUBRIC.map(q => ({ q: q.id, grader: !!v.answers[q.id]?.yes, hand: c.correct[q.id] }));
  const same = questions.filter(x => x.grader === x.hand).length;
  return { ...out, ok: true, agree: same === 15, questions, same, detail: `${same} of 15 questions match the hand score` };
}

// Per model summary rows from a list of case results.
export function summarize(results, models) {
  return models.map(model => {
    const rs = results.filter(r => r.model === model);
    const usable = rs.filter(r => r.ok);
    const agree = usable.filter(r => r.agree).length;
    const known = rs.map(r => r.usd);
    return {
      model, cases: rs.length, usable: usable.length, agree,
      agreement: usable.length ? Number((agree / usable.length * 100).toFixed(1)) + "%" : "n/a",
      unusable: rs.length - usable.length,
      cents_per_case: rs.length && known.every(x => x !== null) ? Number((known.reduce((a, b) => a + b, 0) / rs.length * 100).toFixed(3)) : null,
      reasoning_tokens: rs.length ? Math.round(rs.reduce((n, r) => n + (r.usage?.completion_tokens_details?.reasoning_tokens || 0), 0) / rs.length) : null,
    };
  });
}

// Grader task only: for each question, how many of the usable models matched the hand score, and each model's answer.
export function questionTable(results, models) {
  const rows = [];
  for (const q of RUBRIC) {
    const cells = results.filter(r => r.ok && r.questions).map(r => r.questions.find(x => x.q === q.id));
    const row = { Q: `Q${q.id}`, hand: cells.length ? (cells[0].hand ? "YES" : "NO") : "-" };
    for (const m of models) {
      const mine = results.filter(r => r.model === m && r.ok && r.questions).map(r => r.questions.find(x => x.q === q.id));
      row[m.split("/")[1] || m] = mine.length ? `${mine.filter(x => x.grader === x.hand).length}/${mine.length}` : "-";
    }
    rows.push(row);
  }
  return rows;
}

// Fake model for --dry: a plausible reply per task, no network.
export function dryDeps() {
  return {
    send: async body => {
      const p = body.messages[0].content;
      let content = "BOTH";
      if (p.includes("Reply with JSON only")) content = JSON.stringify({ addresses: "both", reflective_listening: false, validates_feeling: false, open_question: false, invites_to_share: false, ground_rules: false, proposes_solution: false, takes_side: false, lectures: false, proposal_on_table: false, plan_has_specifics: false, meets_needs: { alex: false, jordan: false } });
      else if (p.includes("Output exactly 15 lines")) content = RUBRIC.map(q => `Q${q.id}: NO`).join("\n");
      return { status: 200, ok: true, data: { choices: [{ message: { content } }], usage: { prompt_tokens: 0, completion_tokens: 0, cost: 0 } } };
    },
    prices: {},
  };
}

export async function main(argv) {
  const args = parseArgs(argv);
  const cases = loadCases(args.dir, args.task);
  const budget = { total: 0 };
  const charge = {
    check() { if (budget.total > args.maxCost) throw new BudgetError(`Running cost $${budget.total.toFixed(4)} is over --max-cost $${args.maxCost.toFixed(2)}`); },
    add(usd) { if (usd !== null) budget.total += usd; },
  };
  let deps;
  if (args.dry) deps = { ...dryDeps(), charge };
  else {
    const key = readSetting("OPENROUTER_API_KEY", process.env, path.resolve(".env"));
    if (!key) { console.error("OPENROUTER_API_KEY not found in the environment or .env (use --dry to run without it)."); process.exit(1); }
    deps = { send: c => sendToOpenRouter(c, { key, referer: "http://localhost:3000" }), prices: JSON.parse(fs.readFileSync(new URL("./prices.json", import.meta.url), "utf-8")), charge };
  }
  console.log(`${args.dry ? "DRY RUN (no network). " : ""}${args.task}: ${cases.length} case(s) x ${args.models.length} model(s), max cost $${args.maxCost.toFixed(2)}, zero data retention ${zdrEnabled() ? "ON" : "OFF"}`);
  const examples = cases.filter(c => c.example).length;
  if (examples) console.warn(`WARNING: ${examples} of ${cases.length} case(s) are examples (labels not made by hand). Do not trust these numbers.`);
  const results = [];
  try {
    for (const c of cases) for (const m of args.models) {
      try { results.push(await runCase(args.task, c, m, deps)); }
      catch (e) { if (e instanceof BudgetError) throw e; results.push({ model: m, id: c.id, ok: false, agree: null, detail: e.message, usage: {}, usd: null }); }
    }
  } catch (e) {
    if (!(e instanceof BudgetError)) throw e;
    console.error(`STOPPED: ${e.message}`);
  }
  for (const r of results.filter(x => !x.ok || x.agree === false)) console.log(`  ${r.id} ${r.model}: ${r.detail}`);
  console.table(summarize(results, args.models));
  if (args.task === "grader") console.table(questionTable(results, args.models));
  console.log(`Spend: $${budget.total.toFixed(4)} known.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exit(1); });
}

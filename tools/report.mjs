// Summarises saved runs. Usage: node tools/report.mjs [--dir transcripts] [--include-dry]
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { PERSONAS } from "./personas.mjs";
import { GRADER_MODELS } from "../public/config.js";
import { RUBRIC, parseRubricReply, verifyEvidence } from "../public/rubric.js";
import { OPEN_ENOUGH } from "../public/logic.js";

export function loadRecords(dir, { includeDry = false } = {}) {
  const out = [];
  const walk = d => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".json")) {
        try { const r = JSON.parse(fs.readFileSync(p, "utf-8")); if (r && r.schemaVersion && r.source !== "live" && (includeDry || !r.dry)) out.push(r); } catch {}
      }
    }
  };
  walk(dir);
  return out;
}

const normLoose = s => String(s ?? "").toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// Re-runs the evidence check on each grader's saved raw reply and says why every YES was changed:
// no_quote (bare YES), resident_words (quote is a resident's text), punctuation_only (matches an RA line once
// punctuation is stripped), not_found (nothing like it in the transcript).
export function classifyChanges(records) {
  const out = [];
  for (const r of records) {
    if (!Array.isArray(r.transcript)) continue;
    const isRes = h => ["Alex", "Jordan"].includes(h.sender);
    const ra = r.transcript.filter(h => !isRes(h)).map(h => normLoose(h.text));
    const res = r.transcript.filter(isRes).map(h => normLoose(h.text));
    for (const g of r.graders) {
      if (!g.ok || typeof g.raw !== "string") continue;
      const p = parseRubricReply(g.raw);
      const v = verifyEvidence(p.answers, r.transcript);
      for (const id of v.changed) {
        const quote = p.answers[id].quote, q = normLoose(quote);
        let kind = v.reasons[id];
        if (kind === "not_found") kind = ra.some(t => t.includes(q)) ? "punctuation_only" : res.some(t => t.includes(q)) ? "resident_words" : "not_found";
        out.push({ persona: r.persona.id, grader: g.name, q: id, kind, quote });
      }
    }
  }
  return out;
}

// Per persona: how many sessions ended with a plan both residents accepted (resolved) and the mean turn it happened.
// Records saved before resolution existed have no `resolved` field and are left out.
export function resolutionByPersona(records, ids) {
  return ids.map(id => {
    const rs = records.filter(r => r.persona.id === id && typeof r.resolved === "boolean");
    const turns = rs.filter(r => r.resolved && Number.isInteger(r.resolvedTurn)).map(r => r.resolvedTurn);
    return { persona: id, n: rs.length, resolved: rs.filter(r => r.resolved).length, meanTurn: turns.length ? turns.reduce((a, b) => a + b, 0) / turns.length : null, turns };
  }).filter(x => x.n > 0);
}

// The plan rate bar (option C). The strong-style personas (expectsPlan) pass when at least 75 percent of all their sessions reach a plan
// AND no persona-and-difficulty cell is flagged. A cell is flagged only when it is under 50 percent over 8 or more sessions, so a
// small cell cannot fail the bar by bad luck. Every other persona is reported separately: any plan there is a problem.
export const PLAN_BAR = { overall: 0.75, cellFloor: 0.5, cellMinSessions: 8 };
export function planRates(records) {
  const wants = new Set(PERSONAS.filter(p => p.expectsPlan).map(p => p.id));
  const usable = records.filter(r => typeof r.resolved === "boolean");
  const should = usable.filter(r => wants.has(r.persona.id));
  const byCell = new Map();
  for (const r of should) {
    const key = `${r.persona.id} / ${r.difficulty}`;
    const c = byCell.get(key) || { cell: key, n: 0, resolved: 0 };
    c.n += 1; if (r.resolved) c.resolved += 1;
    byCell.set(key, c);
  }
  const cells = [...byCell.values()].map(c => ({ ...c, rate: c.resolved / c.n, flagged: c.n >= PLAN_BAR.cellMinSessions && c.resolved / c.n < PLAN_BAR.cellFloor })).sort((a, b) => a.cell.localeCompare(b.cell));
  const resolved = should.filter(r => r.resolved).length;
  const overall = { n: should.length, resolved, rate: should.length ? resolved / should.length : null };
  const others = usable.filter(r => !wants.has(r.persona.id));
  const shouldNot = { n: others.length, resolved: others.filter(r => r.resolved).length };
  const pass = overall.n > 0 && overall.rate >= PLAN_BAR.overall && !cells.some(c => c.flagged) && shouldNot.resolved === 0;
  return { overall, cells, shouldNot, pass };
}

// Output tokens per grader call, by grader model. Sessions saved after 2026-11-23 carry the real completion tokens; older ones
// do not, so their size is estimated as characters / 4 (marked estimated). truncated counts replies cut off by the length limit.
const pctile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] : null);
export function graderTokenStats(records) {
  const by = new Map();
  for (const r of records) for (const g of r.graders || []) {
    if (typeof g.raw !== "string") continue;
    const real = Number.isFinite(g.completionTokens);
    const tokens = real ? g.completionTokens : Math.ceil(g.raw.length / 4);
    const e = by.get(g.model) || { model: g.model, calls: 0, tokens: [], truncated: 0, estimated: 0 };
    e.calls += 1; e.tokens.push(tokens); if (!real) e.estimated += 1;
    if (g.finishReason === "length") e.truncated += 1;
    by.set(g.model, e);
  }
  return [...by.values()].map(e => {
    const t = e.tokens.sort((a, b) => a - b);
    return { model: e.model, calls: e.calls, median: pctile(t, 0.5), p95: pctile(t, 0.95), max: t[t.length - 1], truncated: e.truncated, estimated: e.estimated };
  }).sort((a, b) => a.model.localeCompare(b.model));
}

// Why a session did not reach a plan, from its last saved state. One label per unresolved session, most basic cause first.
// Records without openness turns (older files) return null.
export function planBlocker(rec) {
  if (rec.resolved) return null;
  const turns = rec.openness?.turns;
  if (!Array.isArray(turns) || !turns.length) return null;
  const tag = t => t.tags || {};
  if (!turns.some(t => tag(t).proposal_on_table)) return "no plan was ever proposed";
  const last = turns[turns.length - 1];
  if (!tag(last).proposal_on_table) return "the plan was dropped before the end";
  let start = turns.length - 1;
  while (start > 0 && tag(turns[start - 1]).proposal_on_table) start -= 1;
  const low = ["alex", "jordan"].filter(r => (last.openness_after?.[r] ?? 0) < OPEN_ENOUGH);
  if (low.length) return `low trust: ${low.join(" and ")} never reached openness ${OPEN_ENOUGH}`;
  const m = tag(last).meets_needs || {};
  if (!m.alex || !m.jordan) return "the plan broke a must-have (or was changed) at the end";
  if (!turns.slice(start).some(t => tag(t).plan_has_specifics)) return "the plan never had what, when and a check-in";
  const replied = new Set(turns.slice(start).flatMap(t => t.responders || [t.speaker]).map(s => String(s).toLowerCase()));
  if (!(replied.has("alex") && replied.has("jordan"))) return "only one resident answered the plan";
  return "both answered but no clear acceptance (hedged, a question, or out of turns)";
}

// Plans reached by persona and difficulty, and the blockers behind the ones that were not.
export function planCells(records) {
  const cells = new Map();
  for (const r of records) {
    if (typeof r.resolved !== "boolean") continue;
    const key = `${r.persona.id} / ${r.difficulty}`;
    const c = cells.get(key) || { cell: key, n: 0, resolved: 0, turns: [], blockers: {} };
    c.n += 1;
    if (r.resolved) { c.resolved += 1; if (Number.isInteger(r.resolvedTurn)) c.turns.push(r.resolvedTurn); }
    else { const b = planBlocker(r); if (b) c.blockers[b] = (c.blockers[b] || 0) + 1; }
    cells.set(key, c);
  }
  return [...cells.values()];
}

// Share of sessions where each question was not met in the combined vote, overall and by persona.
export function missRates(records) {
  return RUBRIC.map(q => {
    const missed = records.filter(r => !r.combined?.find(c => c.id === q.id)?.met);
    return { id: q.id, group: q.group, missed: missed.length, total: records.length, share: records.length ? missed.length / records.length : null, personas: [...new Set(missed.map(r => r.persona.id))] };
  });
}

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// Persona ids ordered by expected range, highest first. Personas with no expectation go last.
export function personaOrder() {
  const key = p => (p.expected ? [p.expected.min, p.expected.max] : [-1, -1]);
  return PERSONAS.map((p, i) => ({ p, i })).sort((a, b) => key(b.p)[0] - key(a.p)[0] || key(b.p)[1] - key(a.p)[1] || a.i - b.i).map(x => x.p.id);
}

export function buildReport(records) {
  const ids = personaOrder().filter(id => records.some(r => r.persona.id === id));
  const by = id => records.filter(r => r.persona.id === id);

  const scores = ids.map(id => {
    const mets = by(id).map(r => r.result.met).filter(m => typeof m === "number");
    const exp = PERSONAS.find(p => p.id === id).expected;
    const m = mean(mets);
    return { persona: id, n: mets.length, mean: m, min: mets.length ? Math.min(...mets) : null, max: mets.length ? Math.max(...mets) : null, expected: exp, inRange: exp && m !== null ? m >= exp.min && m <= exp.max : null };
  });

  const graderMeans = GRADER_MODELS.map(g => ({
    grader: g.name,
    byPersona: Object.fromEntries(ids.map(id => [id, mean(by(id).flatMap(r => r.graders.filter(x => x.name === g.name && x.ok).map(x => x.metCount)))])),
  }));

  const changed = GRADER_MODELS.map(g => {
    const gs = records.flatMap(r => r.graders.filter(x => x.name === g.name && x.ok));
    return { grader: g.name, sessions: gs.length, changedYesToNo: gs.reduce((n, x) => n + x.changed.length, 0) };
  });

  let asked = 0, disagreed = 0;
  const byQuestion = Object.fromEntries(RUBRIC.map(q => [q.id, { asked: 0, disagreed: 0 }]));
  for (const r of records) {
    const valid = r.graders.filter(g => g.ok);
    if (valid.length < 2) continue;
    for (const q of RUBRIC) {
      const yes = valid.filter(g => g.answers[q.id]?.yes).length;
      asked++; byQuestion[q.id].asked++;
      if (yes > 0 && yes < valid.length) { disagreed++; byQuestion[q.id].disagreed++; }
    }
  }

  const costRoles = ["residents", "ra_sim", "graders", "user_session"];
  const cost = Object.fromEntries(costRoles.map(role => {
    const known = records.filter(r => r.cost?.[role]?.known);
    return [role, { mean: mean(known.map(r => r.cost[role].usd)), sessions: known.length, unknown: records.length - known.length }];
  }));

  // Hidden reasoning tokens per session, by role. These are billed as output, so they show up as cost even though nobody sees them.
  const reasoning = Object.fromEntries(["residents", "tagger", "graders", "ra_sim"].map(role => {
    const rs = records.filter(r => r.usage?.[role]);
    return [role, rs.length ? mean(rs.map(r => r.usage[role].reasoning_tokens || 0)) : null];
  }));
  return { total: records.length, ids, reasoning, planCells: planCells(records), graderTokens: graderTokenStats(records), planRates: planRates(records), resolution: resolutionByPersona(records, ids), misses: missRates(records), changes: classifyChanges(records), scores, graderMeans, changed, disagreement: { asked, disagreed, share: asked ? disagreed / asked : null, byQuestion }, cost };
}

const f = (x, d = 2) => (x === null || x === undefined ? "n/a" : x.toFixed(d));

export function formatReport(rep) {
  if (!rep.total) return "No transcripts found.";
  const L = [`Sessions: ${rep.total}`, "", "(a) Score (questions met out of 15) by persona, in order of expected range", "persona".padEnd(17) + "n".padEnd(4) + "mean".padEnd(7) + "range".padEnd(9) + "expected".padEnd(10) + "check"];
  for (const s of rep.scores) L.push(s.persona.padEnd(17) + String(s.n).padEnd(4) + f(s.mean, 1).padEnd(7) + (s.n ? `${s.min}-${s.max}` : "n/a").padEnd(9) + (s.expected ? `${s.expected.min}-${s.expected.max}` : "none").padEnd(10) + (s.inRange === null ? "" : s.inRange ? "in range" : "OUT"));
  L.push("", "(b) Mean met count by grader and persona", "persona".padEnd(17) + rep.graderMeans.map(g => g.grader.padEnd(10)).join(""));
  for (const id of rep.ids) L.push(id.padEnd(17) + rep.graderMeans.map(g => f(g.byPersona[id], 1).padEnd(10)).join(""));
  L.push("", "(c) YES answers the evidence check changed to NO");
  for (const c of rep.changed) L.push(`${c.grader.padEnd(10)} ${c.changedYesToNo} across ${c.sessions} session(s)`);
  const d = rep.disagreement;
  L.push("", `(d) Questions where valid graders disagreed: ${d.disagreed} of ${d.asked} (${d.share === null ? "n/a" : (d.share * 100).toFixed(1) + "%"})`);
  L.push("    by question: " + RUBRIC.map(q => `Q${q.id} ${d.byQuestion[q.id].asked ? Math.round(d.byQuestion[q.id].disagreed / d.byQuestion[q.id].asked * 100) + "%" : "n/a"}`).join(", "));
  L.push("", "(e) Miss rate per question (not met in the combined vote)", "Q   missed   group");
  for (const m of rep.misses) L.push(`Q${String(m.id).padEnd(3)}${(m.missed + "/" + m.total).padEnd(9)}${((m.share ?? 0) * 100).toFixed(0).padStart(3)}%  ${m.group}${m.share >= 0.9 ? "   <- 90% or more" : ""}`);
  L.push("", "(f) Changed YES answers, by reason");
  const kinds = {};
  for (const c of rep.changes) kinds[c.kind] = (kinds[c.kind] || 0) + 1;
  L.push(Object.keys(kinds).length ? Object.entries(kinds).map(([k, n]) => `${k}: ${n}`).join(", ") : "none");
  for (const c of rep.changes) L.push(`  ${c.persona} / ${c.grader} / Q${c.q} [${c.kind}] ${JSON.stringify(c.quote)}`);
  L.push("", "(g) Mean cost per session (USD, sessions with known cost only)");
  for (const [role, c] of Object.entries(rep.cost)) {
    const name = role === "user_session" ? "user session (residents + graders, no ra_sim)" : role;
    L.push(`${name.padEnd(46)} ${c.mean === null ? "unknown" : "$" + c.mean.toFixed(4)}  (${c.sessions} known, ${c.unknown} unknown)`);
  }
  if (rep.graderTokens?.length) {
    L.push("", "(j) Grader output tokens per call (budget is TOKENS_GRADER in public/config.js; \"estimated\" = characters / 4 for older sessions)");
    L.push("model".padEnd(36) + "calls".padEnd(7) + "median".padEnd(8) + "p95".padEnd(7) + "max".padEnd(7) + "cut off".padEnd(9) + "estimated");
    for (const t of rep.graderTokens) L.push(t.model.padEnd(36) + String(t.calls).padEnd(7) + String(t.median).padEnd(8) + String(t.p95).padEnd(7) + String(t.max).padEnd(7) + String(t.truncated).padEnd(9) + t.estimated);
  }
  const pr = rep.planRates;
  if (pr && (pr.overall.n || pr.shouldNot.n)) {
    const pct = x => (x === null ? "n/a" : `${(x * 100).toFixed(0)}%`);
    L.push("", `(i) Plan rate bar: at least ${PLAN_BAR.overall * 100}% of strong-style sessions reach a plan; no cell under ${PLAN_BAR.cellFloor * 100}% over ${PLAN_BAR.cellMinSessions} or more sessions`);
    L.push(`overall (strong-style personas): ${pr.overall.resolved} of ${pr.overall.n} sessions (${pct(pr.overall.rate)})`);
    for (const c of pr.cells) L.push(`  ${c.cell.padEnd(28)} ${c.resolved} of ${c.n} (${pct(c.rate)})${c.flagged ? "  <- FLAGGED" : c.n < PLAN_BAR.cellMinSessions ? "  (fewer than " + PLAN_BAR.cellMinSessions + " sessions, not judged)" : ""}`);
    L.push(`other personas (must not reach a plan): ${pr.shouldNot.resolved} of ${pr.shouldNot.n} did${pr.shouldNot.resolved ? "  <- PROBLEM" : ""}`);
    L.push(`result: ${pr.pass ? "PASS" : "NOT PASSED"}`);
  }
  L.push("", "    Hidden reasoning tokens per session (billed as output): " + Object.entries(rep.reasoning).map(([k, v]) => `${k} ${v === null ? "n/a" : Math.round(v)}`).join(", "));
  if (rep.planCells?.length) {
    L.push("", "(k) Plans by persona and difficulty, and why the others did not get there");
    for (const c of rep.planCells) {
      L.push(`${c.cell.padEnd(28)} ${c.resolved} of ${c.n} resolved${c.turns.length ? " (turn " + c.turns.join(", ") + ")" : ""}`);
      for (const [b, n] of Object.entries(c.blockers)) L.push(`    ${n}x ${b}`);
    }
  }
  if (rep.resolution?.length) {
    L.push("", "(h) Plans reached (both residents accepted a plan with specifics), by persona", "persona".padEnd(17) + "resolved".padEnd(10) + "turn(s)");
    for (const x of rep.resolution) L.push(x.persona.padEnd(17) + `${x.resolved} of ${x.n}`.padEnd(10) + (x.turns.length ? x.turns.join(", ") : "none"));
  }
  return L.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf("--dir");
  console.log(formatReport(buildReport(loadRecords(i > 0 ? process.argv[i + 1] : "transcripts", { includeDry: process.argv.includes("--include-dry") }))));
}

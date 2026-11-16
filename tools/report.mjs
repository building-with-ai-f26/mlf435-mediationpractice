// Summarises saved runs. Usage: node tools/report.mjs [--dir transcripts] [--include-dry]
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { PERSONAS } from "./personas.mjs";
import { GRADER_MODELS } from "../public/config.js";
import { RUBRIC } from "../public/rubric.js";

export function loadRecords(dir, { includeDry = false } = {}) {
  const out = [];
  const walk = d => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".json")) {
        try { const r = JSON.parse(fs.readFileSync(p, "utf-8")); if (r && r.schemaVersion && (includeDry || !r.dry)) out.push(r); } catch {}
      }
    }
  };
  walk(dir);
  return out;
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
  for (const r of records) {
    const valid = r.graders.filter(g => g.ok);
    if (valid.length < 2) continue;
    for (const q of RUBRIC) {
      const yes = valid.filter(g => g.answers[q.id]?.yes).length;
      asked++;
      if (yes > 0 && yes < valid.length) disagreed++;
    }
  }

  const costRoles = ["residents", "ra_sim", "graders", "user_session"];
  const cost = Object.fromEntries(costRoles.map(role => {
    const known = records.filter(r => r.cost?.[role]?.known);
    return [role, { mean: mean(known.map(r => r.cost[role].usd)), sessions: known.length, unknown: records.length - known.length }];
  }));

  return { total: records.length, ids, scores, graderMeans, changed, disagreement: { asked, disagreed, share: asked ? disagreed / asked : null }, cost };
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
  L.push("", "(e) Mean cost per session (USD, sessions with known cost only)");
  for (const [role, c] of Object.entries(rep.cost)) {
    const name = role === "user_session" ? "user session (residents + graders, no ra_sim)" : role;
    L.push(`${name.padEnd(46)} ${c.mean === null ? "unknown" : "$" + c.mean.toFixed(4)}  (${c.sessions} known, ${c.unknown} unknown)`);
  }
  return L.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf("--dir");
  console.log(formatReport(buildReport(loadRecords(i > 0 ? process.argv[i + 1] : "transcripts", { includeDry: process.argv.includes("--include-dry") }))));
}

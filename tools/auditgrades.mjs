// Cross-checks the graders' final verdicts against evidence that does not come from the graders: the tagger's labels saved with each
// session and simple text checks. Prints, per question, how often they agree and which way the disagreements go. No model calls.
// Usage: node tools/auditgrades.mjs [folder ...]   (default: transcripts out)
// A disagreement is not an error by itself: the text checks are crude. Read the lines behind each one before deciding who is right.
// docs/grading-audit.md has the result of doing that for 30 live sessions.
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { combineGraders } from "../public/rubric.js";

const isRes = s => s === "Alex" || s === "Jordan";
export const AUDITED = [1, 2, 4, 5, 6, 8, 9, 10, 14, 15];

// For one saved session: question id -> true or false, from evidence other than the graders.
export function independentSignals(rec) {
  const tags = (rec.openness?.turns || []).map(t => t.tags).filter(Boolean);
  const to = (t, who) => t.addresses === "both" || t.addresses === who;
  const lines = rec.transcript.filter(t => !isRes(t.sender)).map(t => t.text);
  const all = lines.join(" \n ").toLowerCase();
  return {
    1: /(both|each of you|you both).{0,60}(chance|turn|speak|share)|(chance|turn).{0,40}(both|each)/i.test(lines.slice(0, 2).join(" ")),
    2: tags.some(t => t.ground_rules) || /ground rule|one at a time|take turns|respectful|interrupt/i.test(all),
    4: tags.some(t => to(t, "alex") && t.reflective_listening),
    5: tags.some(t => to(t, "jordan") && t.reflective_listening),
    6: tags.some(t => t.validates_feeling) || /sounds like you|i hear (that )?you|must be (hard|frustrating)|frustrat|exhaust/i.test(all),
    8: !tags.some(t => t.takes_side),
    9: !tags.some(t => t.lectures),
    10: tags.filter(t => t.open_question).length >= 2,
    14: tags.some(t => t.plan_has_specifics),
    15: /check[- ]in|follow[- ]up|check back|next (week|friday|monday|tuesday|thursday)|revisit|roommate living agreement|rhd/i.test(all),
  };
}

// Returns { sessions, perQuestion: { q: { n, agree, gradersYesSignalNo, gradersNoSignalYes } }, rows } for records with graders and a transcript.
export function auditRecords(records) {
  const per = {}, rows = [];
  let sessions = 0;
  for (const rec of records) {
    if (!Array.isArray(rec.graders) || !rec.graders.some(g => g.ok) || !Array.isArray(rec.transcript)) continue;
    sessions++;
    const combined = combineGraders(rec.graders), ind = independentSignals(rec);
    for (const q of AUDITED) {
      const c = combined.find(x => x.id === q), s = per[q] ||= { n: 0, agree: 0, gradersYesSignalNo: 0, gradersNoSignalYes: 0 };
      s.n++;
      if (c.met === ind[q]) s.agree++;
      else {
        if (c.met) s.gradersYesSignalNo++; else s.gradersNoSignalYes++;
        rows.push({ persona: rec.persona?.id, scenario: rec.scenario, q, graders: c.met ? "YES" : "NO", signal: ind[q] ? "YES" : "NO", votes: c.votes });
      }
    }
  }
  return { sessions, perQuestion: per, rows };
}

const walk = p => (fs.statSync(p).isDirectory() ? fs.readdirSync(p).flatMap(n => walk(path.join(p, n))) : p.endsWith(".json") ? [p] : []);

export function main(argv) {
  const dirs = (argv.length ? argv : ["transcripts", "out"]).filter(d => fs.existsSync(d));
  const records = dirs.flatMap(walk).filter(f => !f.includes(`${path.sep}live${path.sep}`)).map(f => { try { return JSON.parse(fs.readFileSync(f, "utf-8")); } catch { return null; } }).filter(r => r && !r.dry && r.persona);
  const a = auditRecords(records);
  console.log(`sessions audited: ${a.sessions}`);
  console.log("question  agree with signal   graders YES, signal NO   graders NO, signal YES");
  for (const q of AUDITED) { const s = a.perQuestion[q]; if (s) console.log(`Q${q}`.padEnd(10) + `${s.agree}/${s.n} (${Math.round(s.agree / s.n * 100)}%)`.padEnd(20) + String(s.gradersYesSignalNo).padEnd(24) + s.gradersNoSignalYes); }
  console.log(`${a.rows.length} disagreements. Read the lines behind each before deciding who is right.`);
  return a;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));

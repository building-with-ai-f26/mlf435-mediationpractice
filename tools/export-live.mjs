// Copies chosen live session files to transcripts/shared/ with personal details removed, so only
// redacted files get committed. transcripts/live/ stays git-ignored.
// Usage: node tools/export-live.mjs <file or folder> [more...] [--out transcripts/shared] [--name <RA name>]
//   --name  also replaces this name with "RA". Live files already store the RA as "RA", so this only
//           matters for files from before that rule or for a name a person typed into a message.
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { scrubName } from "../public/liveRecord.js";

const EMAIL = /[^\s@<>()]+@[^\s@<>()]+\.[A-Za-z]{2,}/;
const PHONE = /(?:\+?\d[\s().-]{0,2}){7,}\d/; // 8 or more digits with optional separators
export const looksPrivate = line => EMAIL.test(line) || PHONE.test(line);
export const REMOVED = "[line removed]";

// Removes any line that looks like an email address or phone number from every string in the record.
// Returns { record, removed } where removed counts the lines taken out. Pure.
export function redactRecord(rec, { name } = {}) {
  let removed = 0;
  const clean = text => {
    const kept = text.split("\n").filter(line => (looksPrivate(line) ? (removed++, false) : true));
    return kept.length ? kept.join("\n") : REMOVED;
  };
  const walk = v => (typeof v === "string" ? clean(v)
    : Array.isArray(v) ? v.map(walk)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
    : v);
  const out = walk(name ? scrubName(rec, name) : rec);
  out.redacted = true;
  return { record: out, removed };
}

export function parseArgs(argv) {
  const a = { inputs: [], out: "transcripts/shared", name: "" };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i];
    if (f === "--out" || f === "--name") {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${f}`);
      if (f === "--out") a.out = v; else a.name = v;
    } else if (f.startsWith("--")) throw new Error(`Unknown flag ${f}`);
    else a.inputs.push(f);
  }
  if (!a.inputs.length) throw new Error("Give at least one file or folder, for example: node tools/export-live.mjs transcripts/live/2026-11-15/101500-noise-medium.json");
  return a;
}

function listJson(p) {
  if (fs.statSync(p).isDirectory()) return fs.readdirSync(p, { withFileTypes: true }).flatMap(e => listJson(path.join(p, e.name)));
  return p.endsWith(".json") ? [p] : [];
}

// Reads each file, redacts it, writes it under outDir/<date folder>/<name>.json. Returns a summary per file.
export function exportFiles(inputs, outDir, { name } = {}) {
  const results = [];
  for (const file of inputs.flatMap(listJson)) {
    const text = fs.readFileSync(file, "utf-8");
    if (text.includes("sk-or-")) { results.push({ file, skipped: "contains sk-or-" }); continue; }
    let rec;
    try { rec = JSON.parse(text); } catch { results.push({ file, skipped: "not valid JSON" }); continue; }
    if (rec?.source !== "live") { results.push({ file, skipped: "not a live session file" }); continue; }
    const { record, removed } = redactRecord(rec, { name });
    const parent = path.basename(path.dirname(file));
    const target = path.join(outDir, /^\d{4}-\d{2}-\d{2}$/.test(parent) ? parent : "", path.basename(file));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(record, null, 2) + "\n");
    results.push({ file, target, removed });
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const a = parseArgs(process.argv.slice(2));
    const results = exportFiles(a.inputs, a.out, { name: a.name });
    for (const r of results) console.log(r.skipped ? `skipped ${r.file}: ${r.skipped}` : `${r.file} -> ${r.target} (${r.removed} line${r.removed === 1 ? "" : "s"} removed)`);
    console.log(`Exported ${results.filter(r => !r.skipped).length} of ${results.length}. Check the files in ${a.out} before committing; redaction is pattern based and cannot catch everything.`);
  } catch (e) { console.error(e.message); process.exit(1); }
}

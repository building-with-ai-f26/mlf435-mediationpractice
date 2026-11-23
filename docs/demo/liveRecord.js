// Builds the record that app.js sends to POST /api/transcript. Pure: no DOM, no network.
// Same shape as the simulator transcripts, plus source "live" (the server adds source and gitCommit).
// The RA's name never leaves the browser: it is replaced by "RA" everywhere.

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Deep copy with every occurrence of the RA's name replaced by "RA".
// Skipped for names too short to match safely or equal to a resident's name.
export function scrubName(value, name) {
  const n = String(name || "").trim();
  if (n.length < 2 || /^(alex|jordan|ra|you)$/i.test(n)) return value;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n)}(?![\\p{L}\\p{N}])`, "giu");
  const walk = v => (typeof v === "string" ? v.replace(re, "RA")
    : Array.isArray(v) ? v.map(walk)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
    : v);
  return walk(value);
}

export function newLiveLog() {
  return { turns: [], usage: {}, saved: false, saving: false };
}

export function addUsage(live, role, usage) {
  const u = (live.usage[role] ||= { calls: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
  u.calls += 1;
  u.prompt_tokens += usage?.prompt_tokens || 0;
  u.completion_tokens += usage?.completion_tokens || 0;
  u.total_tokens += usage?.total_tokens || 0;
}

// live.turns[i]: { turn, at, ra, replies: [{ sender, text }], route: { to, responders, source }, tags, opennessBefore, opennessAfter }
// graders: [{ name, ok, answers, changed, error }] from the debrief, or [] when the session ended early.
export function buildLiveRecord({ session, live, models, rubricVersion, graders = [], combined = null, result = null, partial = false, now = new Date() }) {
  const intro = session.turnHistory.slice(0, 2).map(h => ({ turn: 0, role: "resident", sender: h.sender, text: h.text }));
  const lines = [...intro];
  for (const t of live.turns) {
    lines.push({ turn: t.turn, role: "ra", sender: "RA", text: t.ra, at: t.at });
    for (const r of t.replies) lines.push({ turn: t.turn, role: "resident", sender: r.sender, text: r.text, at: t.at });
  }
  const rec = {
    schemaVersion: 1,
    createdAt: now.toISOString(),
    scenario: session.topic,
    difficulty: session.difficulty,
    partial,
    models,
    rubricVersion,
    resolved: !!session.resolved,
    resolvedTurn: session.resolvedTurn ?? null,
    openness: {
      start: live.opennessStart || null,
      turns: live.turns.map(t => ({ turn: t.turn, tags: t.tags, openness_before: t.opennessBefore, openness_after: t.opennessAfter, resolution: t.resolution ?? null })),
    },
    routing: live.turns.map(t => ({ turn: t.turn, to: t.route.to, responders: t.route.responders, source: t.route.source })),
    transcript: lines,
    graders: graders.map(g => ({
      name: g.name, model: g.model, ok: !!g.ok, answers: g.ok ? g.answers : {}, changed: g.changed || [],
      metCount: g.ok ? Object.values(g.answers).filter(a => a.yes).length : null, ...(g.ok ? {} : { error: g.error }),
    })),
    combined, result,
    usage: live.usage,
  };
  return scrubName(rec, session.raName);
}

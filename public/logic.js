// Pure functions. No DOM, window, or localStorage access, so tests can import this file.

// ---- Routing: which resident answers the RA's message ----

// Case-insensitive word without the i flag, so "Al" and "J" can stay capital-only.
const ci = w => [...w].map(c => `[${c.toLowerCase()}${c.toUpperCase()}]`).join("");
const ALEX_RE = `(?:${ci("alex")}|Al)`;
const JORDAN_RE = `(?:${ci("jordan")}|${ci("jordy")}|${ci("jord")}|J)`;
const NAME_RE = `(${ALEX_RE}|${JORDAN_RE})`;
const nameKey = tok => (new RegExp(`^${ALEX_RE}$`).test(tok) ? "alex" : "jordan");
const OTHER = { alex: "jordan", jordan: "alex" };

// A name used as a reference ("agree with whatever Alex says"), not as the person spoken to.
const REFERENT_PATTERNS = [
  new RegExp(`(\\b(?:agree|agrees|go along|goes along|side|sides|align|match|follow|copy|defer|stick)\\s+(?:with|to)\\s+(?:whatever\\s+|what\\s+)?)${NAME_RE}\\b()`, "g"),
  new RegExp(`(\\b(?:whatever|what|whichever|how)\\s+)${NAME_RE}(\\s+(?:says|said|say|wants|want|suggested|suggests|proposed|proposes|decides|decided|thinks|think|asked|needs|feels|felt|did|does)\\b)`, "g"),
];
const FILLER = "(?:hey|hi|hello|ok|okay|so|well|now|and|thanks|thank you|right|alright)";

// Pure. Returns { to: "alex" | "jordan" | "both" | "unclear" } using names only (no model call).
// Addressed = a name at the start of a sentence, or after a comma at the end of a sentence
// ("What do you think, Alex?"). Names used as references are ignored. If nobody is addressed
// but one resident is named, that resident answers. lastSpeaker is accepted for a stable
// signature; the fallback for "unclear" is chosen by the caller.
export function routeMessage(raText, lastSpeaker) { // eslint-disable-line no-unused-vars
  let text = String(raText || "");
  const referents = new Set();
  for (const re of REFERENT_PATTERNS) {
    text = text.replace(re, (m, pre, name, post) => { referents.add(nameKey(name)); return `${pre}§${post}`; });
  }

  const addressed = [];
  const mentioned = [];
  const add = (list, k) => { if (!list.includes(k)) list.push(k); };
  for (const m of text.matchAll(new RegExp(`\\b${NAME_RE}\\b`, "g"))) add(mentioned, nameKey(m[1]));

  const startRe = new RegExp(`^\\s*(?:${FILLER}[\\s,]+)*\\b${NAME_RE}\\b`);
  const nextRe = new RegExp(`^\\s*(?:,|and|&)\\s*\\b${NAME_RE}\\b`);
  const endRe = new RegExp(`,\\s*\\b${NAME_RE}\\s*[?!.]*\\s*$`);
  for (const sentence of text.match(/[^.!?\n]+[.!?]*/g) || []) {
    let m = sentence.match(startRe);
    if (m) {
      add(addressed, nameKey(m[1]));
      let rest = sentence.slice(m[0].length), n;
      while ((n = rest.match(nextRe))) { add(addressed, nameKey(n[1])); rest = rest.slice(n[0].length); }
    }
    const e = sentence.match(endRe);
    if (e) add(addressed, nameKey(e[1]));
  }

  if (addressed.length >= 2) return { to: "both" };
  if (addressed.length === 1) return { to: addressed[0] };
  if (mentioned.length === 1) return { to: mentioned[0] };
  if (mentioned.length === 0 && referents.size === 1) return { to: OTHER[[...referents][0]] };
  return { to: "unclear" };
}

// Resident names in the order they first appear, for "both" (first named answers first).
// With no names, the resident who did not speak last goes first.
export function bothOrder(raText, lastSpeaker) {
  const found = [];
  for (const m of String(raText || "").matchAll(new RegExp(`\\b${NAME_RE}\\b`, "g"))) {
    const k = nameKey(m[1]);
    if (!found.includes(k)) found.push(k);
  }
  if (found.length === 2) return found;
  return lastSpeaker === "Alex" ? ["jordan", "alex"] : ["alex", "jordan"];
}

// Resident who did not speak last. Used when the router call is skipped, fails or replies badly.
export function fallbackResponder(lastSpeaker) {
  return lastSpeaker === "Alex" ? "jordan" : "alex";
}

// Prompt for the cheap router call: last 3 transcript lines plus the RA message.
export function buildRouterPrompt(history, raText) {
  const recent = (history || []).slice(-3).map(h => `${h.sender}: ${h.text}`).join("\n") || "(no messages yet)";
  return `You route messages in a roommate mediation practice. The two roommates are Alex and Jordan. The RA (resident assistant) just wrote a message that does not clearly name who it is for.

LAST MESSAGES:
${recent}

RA MESSAGE:
${raText}

Decide who the RA message is really for, or who would naturally react to it. Reply with exactly one word: ALEX, JORDAN or BOTH. No other text.`;
}

// Pure. Reads the router reply. Anything other than ALEX, JORDAN or BOTH falls back to the
// resident who did not speak last. Returns { to: "alex" | "jordan" | "both", source: "router" | "fallback" }.
export function parseRouterReply(raw, lastSpeaker) {
  const word = String(raw ?? "").trim().replace(/[.!]+$/, "").toUpperCase();
  if (word === "ALEX" || word === "JORDAN" || word === "BOTH") return { to: word.toLowerCase(), source: "router" };
  return { to: fallbackResponder(lastSpeaker), source: "fallback" };
}

// Old single-resident API, still used by tools/simulate.mjs and mock mode (no model call).
// Returns "Alex" or "Jordan". "both" gives the first named; "unclear" gives the resident who did not speak last.
export function getResponder(raText, lastSpeaker) {
  const { to } = routeMessage(raText, lastSpeaker);
  const key = to === "both" ? bothOrder(raText, lastSpeaker)[0] : to === "unclear" ? fallbackResponder(lastSpeaker) : to;
  return key === "alex" ? "Alex" : "Jordan";
}

// opts: { maxTokens, temperature, reasoning }. Residents use 0.8 / 150. Graders pass their own values.
// reasoning is only added when given, so resident and consolidator requests are unchanged.
export function buildRequestBody(model, messages, opts = {}) {
  const { maxTokens = 150, temperature = 0.8, reasoning } = opts;
  const body = { model, messages, temperature, max_tokens: maxTokens };
  if (reasoning) body.reasoning = reasoning;
  return body;
}

export function extractContent(data) {
  if (!data || !Array.isArray(data.choices) || data.choices.length === 0 || !data.choices[0].message) {
    throw new Error("Empty model response");
  }
  const content = data.choices[0].message.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("Empty model response");
  }
  return content.trim();
}

// ---- Reply cleaning (resident replies) ----

function sanitize(text) {
  return text
    .replace(/[\u2014\u2013]/g, " - ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2026]/g, "...")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function enforce2Paragraphs(text) {
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 0);
  if (paragraphs.length <= 2) return text;
  // Merge all middle paragraphs into paragraph 2
  const first = paragraphs[0];
  const rest = paragraphs.slice(1).join(" ");
  return first + "\n\n" + rest;
}

export function cleanResponse(raw) {
  let t = raw;
  const m = t.match(/^\*\*?\w+\*\*?[\s:]+(.+)$/s);
  if (m) t = m[1];
  t = sanitize(t);
  t = enforce2Paragraphs(t);
  return t;
}

// ---- Earned openness ----
// Each resident has an openness level 0..3. It starts at 1 on easy and 0 otherwise, and moves
// only with what the RA does. There is no turn-count pressure.

export const OPENNESS_MIN = 0;
export const OPENNESS_MAX = 3;

export function startingOpenness(difficulty) {
  const level = difficulty === "easy" ? 1 : 0;
  return { alex: level, jordan: level, progress: { alex: 0, jordan: 0 } };
}

// What the resident does at each level. Quoted by mediationPrompt, found by mock.js via OPENNESS_MARKER.
export const OPENNESS_BANDS = [
  "guarded. Keep it short, defend your position, and do not brainstorm or suggest solutions.",
  "a bit softer in tone and starting to trust the RA. You may acknowledge the other person's point, and you are willing to look at a fair plan, but you do not give up a must-have.",
  "explaining how this really affects you, and willing to consider options.",
  "ready to compromise. You may propose one small concrete step, but only agree to a plan after the RA asks what you would be willing to try.",
];
export const OPENNESS_MARKER = "OPENNESS";

const TAG_FLAGS = ["reflective_listening", "validates_feeling", "open_question", "invites_to_share", "ground_rules", "proposes_solution", "takes_side", "lectures"];
const ADDRESSEES = ["alex", "jordan", "both", "none"];

// profiles (optional): getProfiles() output. When given, the tagger also sees each resident's must-haves
// so it can judge whether a proposal meets them.
export function buildTaggerPrompt(history, raText, profiles = null) {
  const recent = history.slice(-6).map(h => `${h.sender}: ${h.text}`).join("\n");
  const list = r => (profiles?.[r]?.mustHaves || []).map((m, i) => `${i + 1}) ${m}`).join(" ");
  const needs = profiles ? `
What each resident needs for any deal to work (their must-haves):
Alex: ${list("alex")}
Jordan: ${list("jordan")}
` : "";
  return `You label ONE message from a Resident Assistant (RA) who is mediating between two roommates, Alex and Jordan.

Recent conversation:
${recent || "(none)"}
${needs}
RA message to label:
"${raText}"

Reply with JSON only, no other text, in exactly this shape:
{"addresses":"alex|jordan|both|none","reflective_listening":false,"validates_feeling":false,"open_question":false,"invites_to_share":false,"ground_rules":false,"proposes_solution":false,"takes_side":false,"lectures":false,"proposal_on_table":false,"plan_has_specifics":false,"meets_needs":{"alex":false,"jordan":false}}

addresses: who the message is aimed at. "both" if it speaks to both roommates, "none" if neither.
reflective_listening: restates or summarizes what a roommate said.
validates_feeling: names or accepts a roommate's feeling as understandable.
open_question: asks a question that needs more than yes or no.
invites_to_share: asks a roommate to tell their side or needs.
ground_rules: sets rules for the conversation.
proposes_solution: the RA suggests or orders a specific fix.
takes_side: the RA backs one roommate over the other.
lectures: the RA scolds, moralizes or talks down.
proposal_on_table: a specific plan (real times, amounts or actions, not a vague wish) is on the table right now, offered by the RA or a roommate in this message or the recent conversation, and nobody has dropped it.
plan_has_specifics: this RA message states the plan with what each person will do, when, and a check-in time.
meets_needs: for each roommate, true only if proposal_on_table is true and the plan keeps BOTH of that roommate's must-haves listed above. False if no must-haves are listed.`;
}

// Returns the tags object, or null if the reply is not valid. Callers must change nothing on null.
export function parseTags(raw) {
  const text = String(raw || "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let o;
  try { o = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  if (!o || typeof o !== "object" || !ADDRESSEES.includes(o.addresses)) return null;
  const tags = { addresses: o.addresses };
  for (const f of TAG_FLAGS) {
    if (typeof o[f] !== "boolean") return null;
    tags[f] = o[f];
  }
  // Resolution fields. Optional, so an older or shorter tagger reply still parses; anything missing counts as false.
  const m = o.meets_needs && typeof o.meets_needs === "object" ? o.meets_needs : {};
  tags.proposal_on_table = o.proposal_on_table === true;
  tags.plan_has_specifics = o.plan_has_specifics === true;
  tags.meets_needs = { alex: m.alex === true, jordan: m.jordan === true };
  if (!tags.proposal_on_table) tags.meets_needs = { alex: false, jordan: false };
  return tags;
}

const clamp = n => Math.max(OPENNESS_MIN, Math.min(OPENNESS_MAX, n));

// Pure. state: { alex, jordan, progress: { alex, jordan } }. Returns a new state, never mutates.
// tags null (tagger reply did not parse) returns the state unchanged.
export function updateOpenness(state, tags, difficulty) {
  const next = { alex: state.alex, jordan: state.jordan, progress: { alex: state.progress?.alex || 0, jordan: state.progress?.jordan || 0 } };
  if (!tags) return next;
  const addressed = tags.addresses === "both" ? ["alex", "jordan"] : tags.addresses === "none" ? [] : [tags.addresses];
  const other = r => (r === "alex" ? "jordan" : "alex");
  const delta = { alex: 0, jordan: 0 };
  const lowered = { alex: false, jordan: false };

  // Raise: at most +1 per resident per turn. On hard, every second qualifying turn counts.
  if (tags.reflective_listening || tags.validates_feeling) {
    for (const r of addressed) {
      if (difficulty === "hard") {
        next.progress[r] += 1;
        if (next.progress[r] >= 2) { next.progress[r] = 0; delta[r] += 1; }
      } else delta[r] += 1;
    }
  }
  // Drops.
  if (tags.takes_side) {
    // Backing the addressed resident turns the other one against the RA. With no clear target nothing changes.
    if (addressed.length === 1) { delta[other(addressed[0])] -= 1; lowered[other(addressed[0])] = true; }
  }
  if (tags.lectures) for (const r of addressed) { delta[r] -= 1; lowered[r] = true; }
  // A proposal only costs trust when the resident has none yet AND the RA is telling, not asking. A proposal that invites
  // input ("does this work for you?") or comes after the RA earned any trust does not lower anyone.
  const invites = tags.open_question || tags.invites_to_share;
  if (tags.proposes_solution && !invites) for (const r of addressed) if (state[r] < OPEN_ENOUGH) { delta[r] -= 1; lowered[r] = true; }

  for (const r of ["alex", "jordan"]) {
    next[r] = clamp(state[r] + delta[r]);
    if (lowered[r]) next.progress[r] = 0; // a bad turn wipes half-earned progress on hard
  }
  return next;
}

// ---- Resolution ----
// A plan is "resolved" only when the RA's behaviour earned it, not because a clock ran out.
// tags: one entry per RA message, in order (null when the tagger failed). history: turnHistory, the two intros first.
// A resident reply belongs to the RA message before it.

const isResidentName = n => n === "Alex" || n === "Jordan";

// How many consecutive resident replies each resident has given while a proposal that keeps THEIR must-haves stayed on the table.
// A reply in a turn where it did not resets that resident to 0. Zero too if the latest RA message no longer has it on the table.
export function proposalStanding(history, tags = []) {
  const standing = { alex: 0, jordan: 0 };
  let turn = -1;
  for (const h of history) {
    if (!isResidentName(h.sender)) { turn += 1; continue; }
    if (turn < 0) continue; // the two intros come before any RA message
    const r = h.sender.toLowerCase();
    const t = tags[turn];
    standing[r] = t && t.proposal_on_table && t.meets_needs?.[r] ? standing[r] + 1 : 0;
  }
  const last = turn >= 0 ? tags[turn] : null;
  for (const r of ["alex", "jordan"]) if (!(last && last.proposal_on_table && last.meets_needs?.[r])) standing[r] = 0;
  return standing;
}

// A resident at this openness or more may accept a plan that keeps their must-haves. 1 means "starting to trust the RA":
// trust has to be earned (a resident at 0 never accepts) but it does not have to be complete.
export const OPEN_ENOUGH = 1;

// One of: "exploring", "proposal_pending", "accepted_by_one", "resolved".
// exploring: no proposal is on the table. proposal_pending: one is, and fewer than one resident has accepted it
// (also when both accepted but the RA has not yet pinned down what, when and a check-in).
// accepted_by_one: exactly one resident accepted it. resolved: both accepted it, it has specifics.
// A resident's acceptance counts only if that resident's openness is at least 2 and the proposal keeps their must-haves,
// so a hostile, side-taking or lecturing RA (openness stays low) never resolves, whatever the residents say.
export function resolutionState(history, tags = [], openness = {}) {
  const T = tags.length;
  if (!T || !tags[T - 1]?.proposal_on_table) return "exploring";
  let start = T - 1;
  while (start > 0 && tags[start - 1]?.proposal_on_table) start -= 1;

  // Each resident's replies since the plan came up, in order. A reply belongs to the RA message before it.
  const replies = { alex: [], jordan: [] };
  let turn = -1;
  for (const h of history) {
    if (!isResidentName(h.sender)) { turn += 1; continue; }
    if (turn >= start) replies[h.sender.toLowerCase()].push({ turn, text: h.text });
  }
  // A resident has accepted when they confirmed the plan and nothing since has taken it back. Taking it back is:
  //  - a reply that is not a confirmation and hedges or asks something (an objection or a new ask), or
  //  - a reply to an RA message that restated the plan with specifics, when the tagger says it now breaks their must-haves.
  // A neutral reply ("see you Friday") keeps an earlier acceptance. A vague wrap-up message cannot void one either: the
  // tagger's must-have verdict is only trusted on messages that actually state the plan.
  const accepted = { alex: false, jordan: false };
  for (const r of ["alex", "jordan"]) {
    for (const { turn: t, text } of replies[r]) {
      const g = tags[t];
      if (!g) continue; // the tagger failed on this message: no evidence either way
      const confirms = isConfirmation(text);
      if (confirms && g.meets_needs?.[r]) accepted[r] = true;
      else if (g.plan_has_specifics && !g.meets_needs?.[r]) accepted[r] = false;
      else if (!confirms && (HEDGE.test(text) || text.includes("?"))) accepted[r] = false;
    }
    accepted[r] = accepted[r] && (openness[r] ?? 0) >= OPEN_ENOUGH;
  }
  const count = Number(accepted.alex) + Number(accepted.jordan);
  if (count === 1) return "accepted_by_one";
  if (count === 2 && tags.slice(start).some(t => t?.plan_has_specifics)) return "resolved";
  return "proposal_pending";
}

// ---- Progress toward a plan ----
// Pure. Drives the toolbar bar and its gray hint. Never used for grading or for what residents say.
// state: resolutionState(...). openness: { alex, jordan } 0..3. turnCount: RA turns so far.
// Returns { percent 0..100, hint }. Openness is worth up to 60 points, a plan on the table adds 15,
// one acceptance 25, and 100 only when resolved. The hint is one nudge about the next useful move.
export function conversationProgress(state, openness = {}, turnCount = 0) {
  const a = clamp(openness.alex ?? 0), j = clamp(openness.jordan ?? 0);
  if (state === "resolved") return { percent: 100, hint: "Plan reached. Confirm a check-in date, then end the session." };
  const bonus = { exploring: 0, proposal_pending: 15, accepted_by_one: 25 }[state] ?? 0;
  const percent = Math.min(95, Math.round((a + j) / (2 * OPENNESS_MAX) * 60) + bonus);
  let hint;
  if (turnCount === 0) hint = "Start by saying why you are meeting and that both will get a turn.";
  else if (state === "accepted_by_one") hint = "One resident is on board. Ask the other what they could live with.";
  else if (state === "proposal_pending") hint = "Ask each of them if this works, and settle who, what, when and a check-in.";
  else if (Math.min(a, j) < OPEN_ENOUGH) {
    const who = a <= j ? "Alex" : "Jordan";
    hint = `${who} is still guarded. Reflect what ${who} said and name the feeling.`;
  } else hint = "Both are listening. Ask what each would be willing to try or give up.";
  return { percent, hint };
}
// How a resident words an acceptance, so it reads as a real commitment: a plain "That works for me", what they will do and when,
// no question and no "but". isConfirmation() looks for exactly this kind of reply.
const ACCEPT_STYLE = `To accept, start with "That works for me." then say what you will do and when, in one or two short sentences, with no question and no "but".`;

// The must-haves, the flexible items and what to do when a plan is on the table. Empty if the profile has none.
function needsBlock(p, level, standing) {
  if (!p.mustHaves?.length) return "";
  const list = xs => xs.map((x, i) => `${i + 1}) ${x}`).join(" ");
  let rule;
  if (level < OPEN_ENOUGH) {
    rule = "You are not ready to accept any plan yet, even a fair one. Stay guarded until the RA has made you feel heard.";
  } else if (standing >= 1) {
    rule = `A plan that keeps both your must-haves was already on the table for your last turn. You must now either accept it or name ONE specific must-have it fails. Do not repeat an objection you already made, do not offer the same idea back to the RA, and do not stall. ${ACCEPT_STYLE}`;
  } else {
    rule = `If the RA's latest message lays out a plan that keeps both your must-haves, accept it now, once you feel heard. If it fails one, name that ONE must-have and nothing else. ${ACCEPT_STYLE}`;
  }
  return `
WHAT YOU NEED:
Must-haves (no deal works without both): ${list(p.mustHaves)}
Flexible (you can give on these): ${list(p.flexible || [])}
- Never agree to a plan that breaks a must-have. If one does, name the ONE must-have it breaks.
- ${rule}
- If the RA scolds you, takes a side, orders you around or mocks you, get more guarded and do not agree to anything.
`;
}

// openness: 0..3 for the speaker. Defaults to the difficulty's starting level.
// standing: proposalStanding(...)[speaker], how many of this resident's turns a plan that keeps their must-haves has stood.
export function mediationPrompt(topic, difficulty, history, speaker, turnCount, profile, openness, raName = "RA", standing = 0) {
  const speakerKey = speaker.toLowerCase();
  const p = profile[speakerKey];
  const transcript = history.map(h => `${h.sender}: ${h.text}`).join("\n");
  const level = clamp(Number.isInteger(openness) ? openness : startingOpenness(difficulty)[speakerKey]);

  return `You are ${p.name}. ${p.meta}. ${p.trait} Currently ${p.mood}.

Your stance: ${p.stance}

CONVERSATION:
${transcript}

${OPENNESS_MARKER} ${level} of ${OPENNESS_MAX}: you are ${OPENNESS_BANDS[level]}
${needsBlock(p, level, standing)}
RULES:
- Say 1 to 3 short sentences, in a spoken style, the way a college student would talk.
- No lists.
- Address ${raName === "RA" ? "the RA" : raName} directly.
- Do NOT use em dashes. Use periods or commas only.
- Do NOT prefix with "${p.name}:".`;
}

// Record a finished turn. Called only after the resident reply succeeded, so a failed
// request leaves history, turn count, and last speaker untouched.
export function commitTurn(session, raEntry, speaker, replyText) {
  commitReplies(session, raEntry, [{ sender: speaker, text: replyText }]);
}

// Same, for one RA message answered by one or more residents in order. Counts as one RA turn.
export function commitReplies(session, raEntry, replies) {
  session.turnHistory.push(raEntry, ...replies);
  session.turnCount += 1;
  session.lastSpeaker = replies[replies.length - 1].sender;
}

// ---- Agreement detection ----

const HEDGE = /\b(but|however|although|i doubt|not sure|don'?t think|do not think|won'?t|unless|if only)\b/i;
const COMMITMENT = [
  /\bi agree to\b/i,
  /\b(that|this|it|the plan|that plan|this plan|that idea|the idea)( \w+)? works (fine |well )?for me\b/i,
  /\bi'?m willing to (try|do|keep|stick)\b/i,
  /\bdeal\b/i,
  /\bi can live with (that|this|it|the plan)\b/i,
  /\bi'?m (good|fine|okay|ok|on board) with (that|this|it|the plan)\b/i,
  /\bi agree (to|with) (that|this|it|the plan)\b/i,
  /\bsounds good to me\b/i,
  /\byes,? i('|\s)?(ll|will)\b/i,
];
// A concrete plan names a number, a time, or a specific action the speaker will take.
const CONCRETE = /\d|\b(tonight|tomorrow|today|week|weekend|weeknights?|night|nights|morning|midnight|noon|daily|every|after|before|starting|by)\b|\bi('|\s)?(ll|will)\s+\w+/i;

// True only when a resident explicitly commits to a concrete plan.
export function isConfirmation(text) {
  // A question tacked onto an acceptance ("That works for me. Can you check in Friday?") does not void it, so only the
  // statements are judged. A reply that only asks ("Does that work for me?") has no statement and is not an acceptance.
  const t = String(text || "").replace(/[\u2018\u2019]/g, "'").split(/(?<=[.!?])\s+/).filter(s => !s.trim().endsWith("?")).join(" ");
  if (!t) return false;
  if (HEDGE.test(t)) return false;
  if (!COMMITMENT.some(p => p.test(t))) return false;
  return CONCRETE.test(t);
}

// Both residents agree only if each one's LATEST message is a confirmation.
// A later non-confirming message from either resident cancels their agreement.
export function bothAgreed(history) {
  const latest = {};
  for (const h of history) {
    if (h.sender === "Alex" || h.sender === "Jordan") latest[h.sender] = h.text;
  }
  return !!latest.Alex && !!latest.Jordan && isConfirmation(latest.Alex) && isConfirmation(latest.Jordan);
}

// ---- Turn cap and token logging ----

export function isTurnCapReached(turnCount, max) {
  return turnCount >= max;
}

// One console line per API call. Missing usage (some providers omit it) is reported, not hidden.
export function formatUsage(model, usage) {
  if (!usage) return `[tokens] ${model}: usage not reported`;
  const p = usage.prompt_tokens ?? "?";
  const c = usage.completion_tokens ?? "?";
  const t = usage.total_tokens ?? (typeof p === "number" && typeof c === "number" ? p + c : "?");
  return `[tokens] ${model}: prompt=${p} completion=${c} total=${t}`;
}

// Mock mode is on with ?mock=1, and always on for GitHub Pages (hostname ends in github.io),
// where there is no server to proxy API calls.
export function isMockMode(hostname, search) {
  const host = String(hostname || "").toLowerCase();
  return host === "github.io" || host.endsWith(".github.io") || new URLSearchParams(search || "").get("mock") === "1";
}

// Analytics label: 'demo' on GitHub Pages, 'mock' with ?mock=1, otherwise 'live' (local server).
export function getAppMode(hostname, search) {
  const host = String(hostname || "").toLowerCase();
  if (host === "github.io" || host.endsWith(".github.io")) return "demo";
  return new URLSearchParams(search || "").get("mock") === "1" ? "mock" : "live";
}

// Pure. Turns a /healthz reply into footer text, or "" when there is no usable commit.
export function formatBuildLabel(health) {
  const c = health && typeof health.commit === "string" ? health.commit.trim() : "";
  if (!/^[0-9a-f]{4,40}$/i.test(c)) return "";
  return `Build ${c.slice(0, 7)}`;
}

// Pure. Reads the payload of a Google ID token. The browser only uses it for display and expiry;
// the server is the one that verifies the token. Returns null when it cannot be read.
export function decodeIdToken(token) {
  try {
    const part = String(token || "").split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(b64 + "=".repeat((4 - b64.length % 4) % 4)), c => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    return payload && typeof payload === "object" ? payload : null;
  } catch { return null; }
}

// Pure. True when the token reads and has not expired (30 second margin).
export function isTokenValid(token, nowMs) {
  const p = decodeIdToken(token);
  return !!(p && typeof p.exp === "number" && p.exp * 1000 > nowMs + 30000);
}

// Pure. "local" for localhost and 127.0.0.1, "production" otherwise.
export function getEnvName(hostname) {
  const h = String(hostname || "").toLowerCase();
  return h === "localhost" || h === "127.0.0.1" ? "local" : "production";
}

// Pure. Cleans a name from a Google profile before it goes into a prompt: letters, spaces, hyphens and
// apostrophes only, at most 30 characters. Anything else is dropped, so a profile name cannot carry instructions.
// Returns "" when nothing usable is left.
export function cleanFacilitatorName(raw) {
  if (typeof raw !== "string") return "";
  return raw.normalize("NFC")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\p{L}\p{M} '-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 30)
    .trim();
}

// Pure. The name residents and the chat use for the facilitator: the cleaned given_name of a valid
// signed-in token, else "RA". Too short, or the same as a resident, also gives "RA".
export function facilitatorName(token, nowMs) {
  if (!token || !isTokenValid(token, nowMs)) return "RA";
  const n = cleanFacilitatorName(decodeIdToken(token)?.given_name);
  if (n.length < 2 || /^(alex|jordan|ra|you)$/i.test(n)) return "RA";
  return n;
}

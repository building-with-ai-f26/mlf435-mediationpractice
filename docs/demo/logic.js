// Pure functions. No DOM, window, or localStorage access, so tests can import this file.

// Decide which resident answers the RA's message.
// Only one name mentioned: that resident. Both or neither: the resident who did not speak last.
export function getResponder(raText, lastSpeaker) {
  const text = String(raText || "");
  const alex = /\balex\b/i.test(text);
  const jordan = /\bjordan\b/i.test(text);
  if (alex && !jordan) return "Alex";
  if (jordan && !alex) return "Jordan";
  return lastSpeaker === "Alex" ? "Jordan" : "Alex";
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

export function mediationPrompt(topic, difficulty, history, speaker, turnCount, profile) {
  const speakerKey = speaker.toLowerCase();
  const p = profile[speakerKey];
  const transcript = history.map(h => `${h.sender}: ${h.text}`).join("\n");

  let pressure = "";
  if (turnCount >= 6) {
    pressure = "\n\nCRITICAL: This is turn 6+. You MUST show willingness to agree to a compromise. Do not resist anymore.";
  } else if (turnCount >= 4) {
    pressure = "\n\nIMPORTANT: Start showing openness to compromise. Do not just repeat your position.";
  }

  return `You are ${p.name}. ${p.meta}. ${p.trait} Currently ${p.mood}.

Your stance: ${p.stance}

CONVERSATION:
${transcript}${pressure}

RULES:
- MAXIMUM 2 paragraphs.
- MAXIMUM 4 sentences total.
- If you write more than 2 paragraphs, your response will be cut off.
- Address the RA directly.
- Do NOT use em dashes. Use periods or commas only.
- Do NOT prefix with "${p.name}:".
- Respond naturally in 2-4 sentences only.`;
}

// Record a finished turn. Called only after the resident reply succeeded, so a failed
// request leaves history, turn count, and last speaker untouched.
export function commitTurn(session, raEntry, speaker, replyText) {
  session.turnHistory.push(raEntry, { sender: speaker, text: replyText });
  session.turnCount += 1;
  session.lastSpeaker = speaker;
}

// ---- Agreement detection ----

const HEDGE = /\b(but|however|although|i doubt|not sure|don'?t think|do not think|won'?t|unless|if only)\b/i;
const COMMITMENT = [
  /\bi agree to\b/i,
  /\bthat works for me\b/i,
  /\bi'?m willing to (try|do|keep|stick)\b/i,
  /\bdeal\b/i,
  /\byes,? i('|\s)?(ll|will)\b/i,
];
// A concrete plan names a number, a time, or a specific action the speaker will take.
const CONCRETE = /\d|\b(tonight|tomorrow|today|week|weekend|weeknights?|night|nights|morning|midnight|noon|daily|every|after|before|starting|by)\b|\bi('|\s)?(ll|will)\s+\w+/i;

// True only when a resident explicitly commits to a concrete plan.
export function isConfirmation(text) {
  const t = String(text || "").replace(/[\u2018\u2019]/g, "'");
  if (t.includes("?")) return false;
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

// True the first time both residents agree in a session, false afterwards.
// Marks the session so the notice is not repeated.
export function shouldShowAgreementNotice(session) {
  if (session.agreementNoticeShown || !bothAgreed(session.turnHistory)) return false;
  session.agreementNoticeShown = true;
  return true;
}

// Mock mode is on with ?mock=1, and always on for GitHub Pages (hostname ends in github.io),
// where there is no server to proxy API calls.
export function isMockMode(hostname, search) {
  const host = String(hostname || "").toLowerCase();
  return host === "github.io" || host.endsWith(".github.io") || new URLSearchParams(search || "").get("mock") === "1";
}

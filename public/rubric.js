// Yes/no mediation rubric. Pure functions, no DOM or network, so tests can import this file.
// Each grader answers 15 questions; code verifies the quotes, votes across graders, and does the math.

// 2: the grader prompt now requires a quote for the "avoid" questions (Q8, Q9, Q11). No question text changed.
// 4: the parser drops a leading "RA:" label from a quote. Claude often copied it, so correct quotes failed the evidence check and its score collapsed (it agreed with GPT on 71% of questions before, 83% after). No question, prompt or evidence rule changed.
// 3: the three graders changed (Claude Haiku 5.5, Gemini 3.6 Flash, GPT-6 Luna replace DeepSeek, Claude, Llama or Gemini 2.5), so scores are not comparable with versions 1 and 2. No question, prompt or evidence rule changed.
export const RUBRIC_VERSION = 4;

export const RUBRIC = [
  { id: 1, group: "Setting the stage", text: "Did the RA explain why they were meeting and say that both Alex and Jordan would get a chance to speak?", tip: "Start by saying why you are meeting and that each person will get time to speak." },
  { id: 2, group: "Setting the stage", text: "Did the RA set, or ask for, ground rules, such as one person speaking at a time or being respectful?", tip: "Ask the roommates to agree to a few ground rules before the conversation starts." },
  { id: 3, group: "Hearing both sides", text: "Did the RA invite Alex and Jordan, each in turn, to describe their own experience before offering any ideas?", tip: "Give each roommate a turn to describe the situation before you suggest anything." },
  { id: 4, group: "Hearing both sides", text: "Did the RA use reflective listening with Alex, restating what Alex said in different words?", tip: "Restate what you heard in your own words. For example: \"It sounds like you are exhausted and feel ignored.\"" },
  { id: 5, group: "Hearing both sides", text: "Did the RA use reflective listening with Jordan, restating what Jordan said in different words?", tip: "Do the same for the second roommate, so both feel heard." },
  { id: 6, group: "Hearing both sides", text: "Did the RA name or acknowledge a feeling (such as frustration, worry or hesitation) that a roommate expressed?", tip: "Name the feeling you hear. It shows you understood and lowers defensiveness." },
  { id: 7, group: "Hearing both sides", text: "Did the RA help the roommates understand each other's perspective, for example by asking one to say what they heard from the other?", tip: "Ask each roommate what they heard the other say. Understanding comes before compromise." },
  { id: 8, group: "Staying neutral", text: "Did the RA avoid saying or implying that one roommate was right, wrong or at fault?", tip: "Stay neutral. Describe the problem as shared, not as one person's fault." },
  { id: 9, group: "Staying neutral", text: "Did the RA avoid lecturing or telling either roommate what they should do?", tip: "Ask instead of telling. Lecturing makes people defensive." },
  { id: 10, group: "Facilitating", text: "Did the RA ask at least two open-ended questions (such as what, how, or tell me more)?", tip: "Open questions like \"What would help?\" draw out more than yes or no answers." },
  { id: 11, group: "Facilitating", text: "Did the RA wait to discuss solutions until both roommates had spoken and been heard?", tip: "Hold solutions until both people feel heard." },
  { id: 12, group: "Facilitating", text: "Did the RA ask the roommates to come up with options themselves, instead of giving them the solution?", tip: "Your job is to facilitate. Ask \"What could each of you try?\" before offering ideas." },
  { id: 13, group: "Compromise", text: "Did the RA ask each roommate what they would be willing to try or give up?", tip: "Compromise means each person gives something. Ask both what they could do." },
  { id: 14, group: "Closing", text: "Did the RA help the roommates state a specific agreement, including who will do what and when?", tip: "Turn the agreement into something concrete: who, what and when." },
  { id: 15, group: "Closing", text: "Did the RA set up a follow-up, such as a check-in date, revisiting the Roommate Living Agreement, or offering further support?", tip: "Close by scheduling a check-in and pointing to the Roommate Living Agreement and your RHD." },
];

const RESIDENTS = ["Alex", "Jordan"];
const isResident = sender => RESIDENTS.includes(sender);
const label = sender => (isResident(sender) ? sender : "RA");

export function buildRubricPrompt(topic, difficulty, history, raName) {
  const transcript = history.map(h => `${label(h.sender)}: ${h.text}`).join("\n");
  const questions = RUBRIC.map(q => `Q${q.id}. ${q.text}`).join("\n");
  return `Score this RA mediation practice session with a yes/no checklist. The RA is ${raName || "the RA"}. In the transcript the RA's lines start with "RA:".

Situation: ${topic}   Difficulty: ${difficulty}

TRANSCRIPT:
${transcript}

QUESTIONS:
${questions}

Rules:
- Judge ONLY the RA's messages. Never judge the residents.
- Do not consider whether the residents agreed or how the conversation turned out.
- Answer YES only if you can quote the RA. The quote must be copied exactly from an RA message.
- Never write a bare YES. A YES with no quote counts as NO.
- Q8, Q9 and Q11 ask whether the RA held back from something. To answer YES you must still quote one RA line that shows the good behavior: for Q8 a line that treats the problem as shared or stays even-handed, for Q9 a line that asks instead of tells, for Q11 a line that draws out or reflects both roommates before any solution is discussed. If you cannot find such a line, answer NO.
- If you are unsure, answer NO.
- No partial credit. Each answer is YES or NO.

Output exactly 15 lines, one per question, and nothing else. Use this format:
Q1: YES | exact quote of up to 12 words from an RA message
Q2: NO`;
}

// Normalise for quote matching: curly to straight quotes, lowercase, collapse whitespace.
function norm(s) {
  return String(s ?? "")
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Lines look like "Q3: YES | quote" or "Q3: NO". Tolerates bullets, bold, "Q3." or "Q3 -", any case.
const LINE = /^\s*(?:[-*]\s*)?\**\s*Q\s*(\d{1,2})\s*\**\s*[:.)\-]\s*\**\s*(YES|NO)\b\**\s*(?:\|\s*(.*))?$/i;

export function parseRubricReply(raw) {
  const answers = {};
  for (const q of RUBRIC) answers[q.id] = { yes: false, quote: "" };
  const seen = new Set();
  for (const line of String(raw ?? "").split("\n")) {
    const m = line.match(LINE);
    if (!m) continue;
    const id = Number(m[1]);
    if (id < 1 || id > RUBRIC.length || seen.has(id)) continue;
    seen.add(id);
    const yes = m[2].toUpperCase() === "YES";
    // Some graders add commentary after the quote, such as: "Great, Alex." (no quote implies fault; see note).
    // Drop one trailing parenthetical before stripping the quote marks.
    // Graders often copy the transcript's "RA:" label into the quote. The label is not something the RA said, so it is dropped
    // here; the rest of the quote must still be found in an RA message (verifyEvidence is unchanged).
    const quote = yes ? (m[3] ?? "").trim().replace(/\s*\([^()]*\)\s*$/, "").replace(/^["'\u201C\u2018]?\s*RA:\s*/i, "").replace(/^["'\u201C\u2018]+|["'\u201D\u2019]+$/g, "").trim() : "";
    answers[id] = { yes, quote };
  }
  return { ok: seen.size >= 10, answers };
}

// A YES stays YES only if its quote appears inside a message written by the RA.
export function verifyEvidence(answers, history) {
  const raTexts = history.filter(h => !isResident(h.sender)).map(h => norm(h.text));
  const verified = {};
  const changed = [];
  const reasons = {}; // id -> "no_quote" (YES with no quote) or "not_found" (quote is not in any RA message)
  for (const q of RUBRIC) {
    const a = answers[q.id] || { yes: false, quote: "" };
    const quote = norm(a.quote);
    if (a.yes && !(quote && raTexts.some(t => t.includes(quote)))) {
      verified[q.id] = { yes: false, quote: "" };
      changed.push(q.id);
      reasons[q.id] = quote ? "not_found" : "no_quote";
    } else {
      verified[q.id] = { yes: a.yes, quote: a.quote };
    }
  }
  return { answers: verified, changed, reasons };
}

// gradings: array of parseRubricReply results (after verifyEvidence). Invalid ones (ok false) are ignored.
// 3 valid: 2 YES needed. 2 valid: both. 1 valid: it decides. 0 valid: nothing is met.
export function combineGraders(gradings) {
  const valid = gradings.filter(g => g && g.ok && g.answers);
  const needed = valid.length >= 3 ? 2 : valid.length;
  return RUBRIC.map(q => {
    const yesVotes = valid.filter(g => g.answers[q.id]?.yes);
    return {
      id: q.id,
      met: valid.length > 0 && yesVotes.length >= needed,
      votes: yesVotes.length,
      quote: yesVotes.find(g => g.answers[q.id].quote)?.answers[q.id].quote ?? "",
    };
  });
}

export function scoreFromCombined(combined) {
  const met = combined.filter(c => c.met).length;
  const total = RUBRIC.length;
  return { met, total, score: Math.round(met / total * 100) };
}

export function coachingSummary(combined) {
  const metIds = new Set(combined.filter(c => c.met).map(c => c.id));
  const missed = RUBRIC.filter(q => !metIds.has(q.id));
  return { missed, nextTip: missed.length ? missed[0].tip : null };
}

import { getResponder, commitTurn, mediationPrompt, buildRequestBody, extractContent, parseGrading, computeOverallScore, bothAgreed, shouldShowAgreementNotice, isTurnCapReached, formatUsage } from "./logic.js";
import { mockResponse } from "./mock.js";

const API_URL = "/api/chat";
// Keep in sync with server.mjs (ALLOWED_MODELS). The two lists must match.
const MAIN_MODEL = "deepseek/deepseek-chat";
const GRADER_MODELS = [
  { id: "deepseek/deepseek-chat", name: "DeepSeek" },
  { id: "anthropic/claude-haiku-5.5", name: "Claude" },
  { id: "google/gemini-2.5-flash",     name: "Gemini" },
];
const CONSOLIDATOR_MODEL = "deepseek/deepseek-chat";
const TOKENS_RESIDENT = 150;
const TOKENS_GRADER = 600;
const TOKENS_CONSOLIDATOR = 700;
const MAX_TURNS = 10;
// ?mock=1 serves canned replies and grades. No fetch, no API key, no cost.
const MOCK = new URLSearchParams(location.search).get("mock") === "1";

const HINTS = [
  "Try asking: 'Alex, what would help you feel comfortable in your room past 10pm?'",
  "Try asking: 'Jordan, what time do you usually get back from evening classes?'",
  "Try asking: 'What is one small change each of you could try this week?'",
  "Try asking: 'Can you both describe what a good compromise would look like?'",
  "Try saying: 'I hear both of you. Let me make sure I understand...' then restate both sides.",
  "Try asking: 'Alex, what is the latest you could tolerate some noise?'",
  "Try asking: 'Jordan, what is the earliest you could start keeping things quieter?'",
  "Try proposing: 'What if we try a 2-week experiment with specific quiet hours and check in after?'",
];

const $ = id => document.getElementById(id);

const DOM = {
  setup: $("setup"), chatView: $("chat-view"), debriefView: $("debrief-view"),
  raNameInput: $("ra-name"), topicSelect: $("topic-select"), difficultySelect: $("difficulty"),
  startBtn: $("start-btn"), raNameDisplay: $("ra-name-display"),
  topicBadge: $("topic-badge"), difficultyBadge: $("difficulty-badge"),
  residentCards: $("resident-cards"), chatLog: $("chat-log"),
  raInput: $("ra-input"), sendBtn: $("send-btn"), endBtn: $("end-btn"),
  debriefRaName: $("debrief-ra-name"), debriefTopic: $("debrief-topic"),
  debriefDifficulty: $("debrief-difficulty"),
  graderCards: $("grader-cards"), consolidated: $("consolidated-content"),
  restartBtn: $("restart-btn"), turnCounter: $("turn-counter"),
};

let session = {
  raName: "", topic: "noise", difficulty: "medium",
  turnHistory: [], active: false, lastSpeaker: "Jordan", turnCount: 0,
  agreementNoticeShown: false,
};

/* ============================================================
   PROFILES
   ============================================================ */

function getProfiles(topic, difficulty) {
  const traits = {
    easy:   { alex: "annoyed but open", jordan: "defensive but reasonable" },
    medium: { alex: "frustrated, exhausted", jordan: "defensive, feels attacked" },
    hard:   { alex: "at breaking point", jordan: "angry, shutting down" },
  };
  const stances = {
    noise: {
      alex: "Jordan's noise past midnight prevents sleep. Early classes are suffering.",
      jordan: "Evening classes mean late nights. Alex expects silence at 9pm, which is unrealistic.",
    },
    cleaning: {
      alex: "Jordan never cleans. Shared spaces are a mess. Alex does all the work.",
      jordan: "Alex rearranges Jordan's things without asking. The standard is obsessive, not fair.",
    },
    "guest policy": {
      alex: "Jordan's partner stays over 4 nights a week. Alex never agreed to a third roommate.",
      jordan: "Alex is never here. The guest is quiet and respectful. This is not a real problem.",
    },
    hygiene: {
      alex: "Jordan's laundry piles up for weeks. The smell is embarrassing when anyone visits.",
      jordan: "Alex's scented products give Jordan headaches. Requests to change them were ignored.",
    },
    "shared items": {
      alex: "Jordan borrows food, chargers, clothes without asking. Nothing gets replaced.",
      jordan: "Alex labels everything. Sharing was supposed to be part of living together.",
    },
  };
  const t = traits[difficulty] || traits.medium;
  const s = stances[topic] || stances.noise;
  return {
    alex:  { name: "Alex",  handle: "@alex.bio26",  meta: "20 · Junior · Biology",        trait: "Early riser. Needs structure and quiet.", mood: t.alex,  stance: s.alex },
    jordan:{ name: "Jordan",handle: "@jordan.comm25",meta: "19 · Sophomore · Communications",trait: "Night owl. Social, values freedom.",  mood: t.jordan,stance: s.jordan},
  };
}

function renderCards(profiles) {
  DOM.residentCards.innerHTML = `
    <div class="resident-card alex">
      <div class="card-header"><span class="card-name">${profiles.alex.name}</span><span class="card-handle">${profiles.alex.handle}</span></div>
      <div class="card-meta">${profiles.alex.meta}</div>
      <div class="card-trait">${profiles.alex.trait}</div>
      <div class="card-stance">${profiles.alex.stance}</div>
    </div>
    <div class="resident-card jordan">
      <div class="card-header"><span class="card-name">${profiles.jordan.name}</span><span class="card-handle">${profiles.jordan.handle}</span></div>
      <div class="card-meta">${profiles.jordan.meta}</div>
      <div class="card-trait">${profiles.jordan.trait}</div>
      <div class="card-stance">${profiles.jordan.stance}</div>
    </div>`;
}

/* ============================================================
   PROMPTS
   ============================================================ */

function alexPrompt(topic, difficulty, profile) {
  const d = { easy: "cooperative", medium: "frustrated", hard: "very upset" }[difficulty];
  return `You are Alex. ${profile.alex.meta}. ${profile.alex.trait} Currently ${profile.alex.mood}.

The issue: ${profile.alex.stance}

RULES:
- Output EXACTLY 2 paragraphs, separated by one blank line.
- Paragraph 1 must be exactly 2 sentences.
- Paragraph 2 must be exactly 2 sentences.
- Paragraph 1: Introduce yourself and state the problem.
- Paragraph 2: Say how it affects you and ask the RA one question.
- Do NOT use em dashes. Use periods only.
- Do NOT write more than 4 sentences total.
- Do NOT write one long paragraph.
- Do NOT mention Jordan.
- Do NOT prefix with "Alex:".`;
}

function jordanPrompt(topic, difficulty, profile, alexMsg) {
  const d = { easy: "cooperative", medium: "frustrated", hard: "very upset" }[difficulty];
  return `You are Jordan. ${profile.jordan.meta}. ${profile.jordan.trait} Currently ${profile.jordan.mood}.

The issue: ${profile.jordan.stance}

Alex said: "${alexMsg}"

RULES:
- Output EXACTLY 2 paragraphs, separated by one blank line.
- Paragraph 1 must be exactly 2 sentences.
- Paragraph 2 must be exactly 2 sentences.
- Paragraph 1: Introduce yourself and state your side.
- Paragraph 2: Push back without hostility. End with how you feel.
- Do NOT use em dashes. Use periods only.
- Do NOT write more than 4 sentences total.
- Do NOT write one long paragraph.
- Do NOT prefix with "Jordan:".`;
}

function graderPrompt(modelName, topic, difficulty, history) {
  const transcript = history.map(h => `${h.sender}: ${h.text}`).join("\n");
  return `Grade this RA mediation practice session.

IMPORTANT: Grade ONLY the MEDIATOR (the RA). Never grade the residents.

Situation: ${topic}   Difficulty: ${difficulty}

TRANSCRIPT:
${transcript}

Respond EXACTLY in this format with NO extra text before or after:
SCORE: [number]/100
STRENGTHS:
- [specific mediator strength]
- [specific mediator strength]
GAPS:
- [specific mediator gap]
- [specific mediator gap]

Rules:
- Score 70-100 if mediator listened, validated, and proposed solutions.
- Score 40-69 if mediator tried but missed key steps.
- Score 0-39 if mediator did very little or took sides.
- NO em dashes.`;
}

function consolidatorPrompt(gradings, overall) {
  const valid = gradings.filter(gr => gr.score !== null);
  const g = valid.map((gr, i) => `GRADER ${i + 1} (${gr.model}): ${gr.score}/100\nStrengths:\n${gr.strengths.map(s => "- " + s).join("\n")}\nGaps:\n${gr.gaps.map(x => "- " + x).join("\n")}`).join("\n\n---\n\n");
  return `${valid.length} AI supervisor(s) graded the same RA mediation. The overall score is ${overall}/100 and is already computed. Consolidate the feedback into one debrief.

${g}

Output EXACTLY the following sections. Do NOT output any score line or number out of 100.

WHAT YOU DID WELL:
- [specific action with transcript reference]
- [specific action with transcript reference]
- [specific action with transcript reference]

WHAT YOU MISSED:
- [specific gap with what to do instead]
- [specific gap with what to do instead]
- [specific gap with what to do instead]

ONE THING TO TRY NEXT TIME:
- [one concrete technique]

Rules:
- NO em dashes. Periods, commas, colons, hyphens only.
- ALL feedback about the MEDIATOR only.`;
}

/* ============================================================
   UI HELPERS
   ============================================================ */

function msgEl(sender, text, type) {
  const div = document.createElement("div");
  div.className = `message ${type}`;
  const lbl = document.createElement("span");
  lbl.className = "msg-sender";
  lbl.textContent = sender;
  const body = document.createElement("div");
  body.className = "msg-body";
  body.textContent = text;
  div.appendChild(lbl);
  div.appendChild(body);
  return div;
}

function sysEl(text) {
  const div = document.createElement("div");
  div.className = "message system";
  const b = document.createElement("div");
  b.className = "msg-body";
  b.textContent = text;
  div.appendChild(b);
  return div;
}

function showLoading() {
  const el = document.getElementById("loading-indicator");
  if (el) el.classList.remove("hidden");
}
function hideLoading() {
  const el = document.getElementById("loading-indicator");
  if (el) el.classList.add("hidden");
}
function scrollToBottom() {
  DOM.chatLog.scrollTop = DOM.chatLog.scrollHeight;
}
function updateTurnCounter() {
  if (DOM.turnCounter) DOM.turnCounter.textContent = `Turn ${Math.min(session.turnCount, MAX_TURNS)} of ${MAX_TURNS}`;
}
function setInput(enabled) {
  DOM.raInput.disabled = !enabled;
  DOM.sendBtn.disabled = !enabled;
  DOM.endBtn.disabled = !enabled;
  if (enabled) DOM.raInput.focus();
}

/* ============================================================
   API
   ============================================================ */

async function call(model, messages, maxTokens = TOKENS_RESIDENT) {
  let data;
  if (MOCK) {
    await new Promise(r => setTimeout(r, 150));
    data = mockResponse(model, messages);
  } else {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildRequestBody(model, messages, maxTokens)),
    });
    data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error?.message || "API error");
  }
  console.log(formatUsage(model, data.usage));
  if (data.choices?.[0]?.finish_reason === "length") {
    console.warn(`[call] Model ${model} response truncated (finish_reason: length)`);
  }
  return extractContent(data);
}

/* ============================================================
   TEXT PROCESSING
   ============================================================ */

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

function cleanResponse(raw) {
  let t = raw;
  const m = t.match(/^\*\*?\w+\*\*?[\s:]+(.+)$/s);
  if (m) t = m[1];
  t = sanitize(t);
  t = enforce2Paragraphs(t);
  return t;
}

/* ============================================================
   SESSION FLOW
   ============================================================ */

function saveLog() {
  const logs = JSON.parse(localStorage.getItem("ra_logs") || "[]");
  logs.push({
    timestamp: new Date().toISOString(),
    raName: session.raName,
    topic: session.topic,
    difficulty: session.difficulty,
    transcript: session.turnHistory,
  });
  localStorage.setItem("ra_logs", JSON.stringify(logs.slice(-20)));
}

async function startSession() {
  session.raName = DOM.raNameInput.value.trim() || "You";
  session.topic = DOM.topicSelect.value;
  session.difficulty = DOM.difficultySelect.value;
  session.turnHistory = [];
  session.active = true;
  session.lastSpeaker = "Jordan";
  session.turnCount = 0;
  session.agreementNoticeShown = false;
  updateTurnCounter();

  DOM.raNameDisplay.textContent = session.raName;
  DOM.topicBadge.textContent = session.topic;
  DOM.difficultyBadge.textContent = session.difficulty;

  DOM.setup.classList.add("hidden");
  DOM.chatView.classList.remove("hidden");
  DOM.debriefView.classList.add("hidden");
  DOM.chatLog.innerHTML = "";
  DOM.graderCards.innerHTML = "";
  DOM.consolidated.innerHTML = "";

  const profiles = getProfiles(session.topic, session.difficulty);
  session.profiles = profiles;
  renderCards(profiles);

  DOM.chatLog.appendChild(sysEl(MOCK ? "Session started. MOCK MODE: canned replies, no API calls." : "Session started."));
  setInput(false);

  try {
    showLoading();
    const alexRaw = await call(MAIN_MODEL, [{ role: "system", content: alexPrompt(session.topic, session.difficulty, profiles) }]);
    hideLoading();
    const alexText = cleanResponse(alexRaw);
    console.log("[Alex raw]", alexRaw);
    console.log("[Alex clean]", alexText);
    DOM.chatLog.appendChild(msgEl("Alex", alexText, "alex"));
    session.turnHistory.push({ sender: "Alex", text: alexText });
    scrollToBottom();

    showLoading();
    const jordanRaw = await call(MAIN_MODEL, [{ role: "system", content: jordanPrompt(session.topic, session.difficulty, profiles, alexText) }]);
    hideLoading();
    const jordanText = cleanResponse(jordanRaw);
    console.log("[Jordan raw]", jordanRaw);
    console.log("[Jordan clean]", jordanText);
    DOM.chatLog.appendChild(msgEl("Jordan", jordanText, "jordan"));
    session.turnHistory.push({ sender: "Jordan", text: jordanText });
    session.lastSpeaker = "Jordan";
    scrollToBottom();

    DOM.chatLog.appendChild(sysEl("Both residents have shared their sides. Begin mediating."));
    setInput(true);
  } catch (err) {
    hideLoading();
    DOM.chatLog.appendChild(sysEl(`Error: ${err.message}. Refresh to retry.`));
    console.error(err);
  }
}

async function send() {
  const text = DOM.raInput.value.trim();
  if (!text || !session.active || isTurnCapReached(session.turnCount, MAX_TURNS)) return;

  const raEntry = { sender: session.raName, text };
  const raEl = msgEl(session.raName, text, "ra");
  DOM.chatLog.appendChild(raEl);
  DOM.raInput.value = "";
  setInput(false);
  showLoading();
  scrollToBottom();

  const turn = session.turnCount + 1;
  const speaker = getResponder(text, session.lastSpeaker);
  console.log("[Routing] RA said:", text, "| responder:", speaker);

  try {
    const raw = await call(MAIN_MODEL, [{ role: "system", content: mediationPrompt(session.topic, session.difficulty, [...session.turnHistory, raEntry], speaker, turn, session.profiles) }]);
    hideLoading();
    const cleanText = cleanResponse(raw);
    console.log("[Response raw]", raw);
    console.log("[Response clean]", cleanText);

    const type = speaker.toLowerCase() === "alex" ? "alex" : "jordan";

    DOM.chatLog.appendChild(msgEl(speaker, cleanText, type));
    commitTurn(session, raEntry, speaker, cleanText);
    if (shouldShowAgreementNotice(session)) {
      DOM.chatLog.appendChild(sysEl("It looks like you have reached an agreement. Click End & Debrief to finish."));
    }
    updateTurnCounter();
    if (isTurnCapReached(session.turnCount, MAX_TURNS)) {
      // Input and Send stay locked. End & Debrief must stay enabled.
      DOM.chatLog.appendChild(sysEl("Turn limit reached. Click End & Debrief to finish."));
      DOM.endBtn.disabled = false;
    } else {
      setInput(true);
    }
    scrollToBottom();
  } catch (err) {
    hideLoading();
    // Nothing was committed to the session, so only the screen and input need restoring.
    raEl.remove();
    DOM.raInput.value = text;
    DOM.chatLog.appendChild(sysEl(`Error: ${err.message}. Try again.`));
    setInput(true);
    console.error(err);
  }
}

async function end() {
  if (!session.active) return;
  session.active = false;
  setInput(false);
  saveLog();

  DOM.chatView.classList.add("hidden");
  DOM.debriefView.classList.remove("hidden");
  DOM.debriefRaName.textContent = session.raName;
  DOM.debriefTopic.textContent = toTitleCase(session.topic);
  DOM.debriefDifficulty.textContent = toTitleCase(session.difficulty);
  DOM.consolidated.innerHTML = '<div class="message system"><div class="msg-body">Sending to 3 AI graders. This takes 10-20 seconds.</div></div>';

  try {
    const results = await Promise.all(
      GRADER_MODELS.map(async g => {
        try {
          const raw = await call(g.id, [{ role: "system", content: graderPrompt(g.name, session.topic, session.difficulty, session.turnHistory) }], TOKENS_GRADER);
          console.log(`[Grader ${g.name} FULL RAW]:`, raw);
          const parsed = parseGrading(raw, g.name);
          console.log(`[Grader ${g.name} PARSED]:`, parsed);
          return parsed;
        } catch (e) {
          console.error(`[Grader ${g.name} FAILED]:`, e.message);
          return { model: g.name, score: null, strengths: ["Grading failed: " + e.message], gaps: ["Check API key or model availability"] };
        }
      })
    );

    renderGraderCards(results);

    DOM.consolidated.innerHTML = '<div class="message system"><div class="msg-body">Consolidating feedback...</div></div>';
    const overall = computeOverallScore(results);
    if (overall === null) {
      DOM.consolidated.innerHTML = '<div class="section-block"><div class="score-display"><div class="score-label">Overall score unavailable</div></div><p>All graders failed, so there is no feedback to consolidate.</p></div>';
      return;
    }
    const consolidatedRaw = await call(CONSOLIDATOR_MODEL, [{ role: "system", content: consolidatorPrompt(results, overall) }], TOKENS_CONSOLIDATOR);
    renderConsolidated(consolidatedRaw, overall);
  } catch (err) {
    DOM.consolidated.innerHTML = `<div class="section-block">Error: ${esc(err.message)}</div>`;
    console.error(err);
  }
}

/* ============================================================
   GRADING
   ============================================================ */

function renderGraderCards(gradings) {
  DOM.graderCards.innerHTML = gradings.map(g => `
    <div class="grader-card">
      <div class="grader-name">${g.model}</div>
      ${g.score === null
        ? '<div class="grader-note">grader unavailable</div>'
        : `<div class="grader-score">${g.score}</div><div class="grader-note">out of 100</div>`}
      <ul>${g.strengths.map(s => `<li>${esc(s)}</li>`).join("")}</ul>
      <div class="grader-note" style="margin-top:8px;">Gaps:</div>
      <ul>${g.gaps.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
    </div>
  `).join("");
}

function renderConsolidated(raw, overall) {
  const lines = raw.split("\n");
  let sections = [];
  let cur = null;

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;

    if (/^OVERALL SCORE:/i.test(t)) {
      continue; // score comes from code, never from the model
    } else if (/^WHAT YOU DID WELL:/i.test(t)) {
      cur = { type: "well", items: [], title: "What You Did Well" };
      sections.push(cur);
    } else if (/^WHAT YOU MISSED:/i.test(t)) {
      cur = { type: "missed", items: [], title: "What You Missed" };
      sections.push(cur);
    } else if (/^ONE THING TO TRY NEXT TIME:/i.test(t)) {
      cur = { type: "next", items: [], title: "One Thing to Try Next Time" };
      sections.push(cur);
    } else if ((t.startsWith("- ") || t.startsWith("* ")) && cur) {
      cur.items.push(t.slice(2));
    } else if (cur && cur.items.length === 0) {
      // First line of a section that doesn't start with dash (e.g., ONE THING body)
      cur.items.push(t);
    } else if (cur) {
      // Continuation of previous bullet or text block
      cur.items[cur.items.length - 1] += " " + t;
    }
  }

  let html = overall === null
    ? '<div class="score-display"><div class="score-label">Overall score unavailable</div></div>'
    : `<div class="score-display"><div class="score-number">${overall}/100</div><div class="score-label">Overall Score</div></div>`;
  for (const s of sections) {
    if (s.type === "next") {
      html += `<div class="section-block"><h3>${s.title}</h3><ul>${s.items.map(i => `<li>${esc(i)}</li>`).join("")}</ul></div>`;
    } else if (s.items.length > 0) {
      html += `<div class="section-block"><h3>${s.title}</h3><ul>${s.items.map(i => `<li>${esc(i)}</li>`).join("")}</ul></div>`;
    } else {
      html += `<div class="section-block"><h3>${s.title}</h3><p>${esc(s.title)} section empty</p></div>`;
    }
  }

  if (sections.length === 0) {
    html = `<div class="section-block"><pre style="font-size:12px;white-space:pre-wrap">${esc(raw)}</pre></div>`;
  }

  DOM.consolidated.innerHTML = html;
}

function esc(text) {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

function toTitleCase(str) {
  return str.replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

/* ============================================================
   EVENTS
   ============================================================ */

DOM.startBtn.addEventListener("click", startSession);
DOM.sendBtn.addEventListener("click", send);
DOM.endBtn.addEventListener("click", end);

const hintBtn = document.getElementById("hint-btn");
if (hintBtn) {
  hintBtn.addEventListener("click", () => {
    const hint = HINTS[Math.floor(Math.random() * HINTS.length)];
    DOM.chatLog.appendChild(sysEl("Hint: " + hint));
    scrollToBottom();
  });
}

DOM.restartBtn.addEventListener("click", () => {
  DOM.setup.classList.remove("hidden");
  DOM.chatView.classList.add("hidden");
  DOM.debriefView.classList.add("hidden");
  DOM.chatLog.innerHTML = "";
  DOM.residentCards.innerHTML = "";
  DOM.raInput.value = "";
});

DOM.raInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

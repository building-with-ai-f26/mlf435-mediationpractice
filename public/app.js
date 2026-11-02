const API_URL = "/api/chat";
const MAIN_MODEL = "deepseek/deepseek-chat";
const GRADER_MODELS = [
  { id: "deepseek/deepseek-chat", name: "DeepSeek" },
  { id: "anthropic/claude-fable-5.1", name: "Claude" },
  { id: "google/gemini-2.5-flash",     name: "Gemini" },
];
const CONSOLIDATOR_MODEL = "deepseek/deepseek-chat";

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
  setup, chatView, debriefView,
  raNameInput, topicSelect, difficultySelect,
  startBtn, raNameDisplay, topicBadge, difficultyBadge,
  residentCards, chatLog, raInput, sendBtn, endBtn,
  debriefRaName, debriefTopic, debriefDifficulty,
  graderCards, consolidated, restartBtn,
} = {
  setup: $("setup"), chatView: $("chat-view"), debriefView: $("debrief-view"),
  raNameInput: $("ra-name"), topicSelect: $("topic-select"), difficultySelect: $("difficulty"),
  startBtn: $("start-btn"), raNameDisplay: $("ra-name-display"),
  topicBadge: $("topic-badge"), difficultyBadge: $("difficulty-badge"),
  residentCards: $("resident-cards"), chatLog: $("chat-log"),
  raInput: $("ra-input"), sendBtn: $("send-btn"), endBtn: $("end-btn"),
  debriefRaName: $("debrief-ra-name"), debriefTopic: $("debrief-topic"),
  debriefDifficulty: $("debrief-difficulty"),
  graderCards: $("grader-cards"), consolidated: $("consolidated-content"),
  restartBtn: $("restart-btn"),
};

let session = {
  raName: "", topic: "noise", difficulty: "medium",
  turnHistory: [], active: false, nextSpeaker: "Alex",
  alexAgreed: false, jordanAgreed: false, turnCount: 0,
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

function mediationPrompt(topic, difficulty, history, nextSpeaker, turnCount) {
  const d = { easy: "cooperative", medium: "frustrated", hard: "very upset and resistant" }[difficulty];
  const transcript = history.map(h => `${h.sender}: ${h.text}`).join("\n");

  let pressure = "";
  if (turnCount >= 6) {
    pressure = "\n\nCRITICAL: This is turn 6+. You MUST show willingness to agree to a compromise. Do not resist anymore.";
  } else if (turnCount >= 4) {
    pressure = "\n\nIMPORTANT: Start showing openness to compromise. Do not just repeat your position.";
  }

  return `You are ${nextSpeaker}. Difficulty: ${difficulty}.

CONVERSATION:
${transcript}${pressure}

RULES:
- MAXIMUM 2 paragraphs.
- MAXIMUM 4 sentences total.
- If you write more than 2 paragraphs, your response will be cut off.
- Address the RA directly.
- Stay in character (Alex: needs quiet / Jordan: needs freedom).
- Do NOT use em dashes. Use periods or commas only.
- Do NOT prefix with "${nextSpeaker}:".
- Respond naturally in 2-4 sentences only.`;
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

function consolidatorPrompt(gradings, history) {
  const g = gradings.map((gr, i) => `GRADER ${i + 1} (${gr.model}): ${gr.score}/100\nStrengths:\n${gr.strengths.map(s => "- " + s).join("\n")}\nGaps:\n${gr.gaps.map(x => "- " + x).join("\n")}`).join("\n\n---\n\n");
  return `Three AI supervisors graded the same RA mediation. Consolidate into one debrief.

${g}

Output EXACTLY:

OVERALL SCORE: [average of 3 scores]/100

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
function setInput(enabled) {
  DOM.raInput.disabled = !enabled;
  DOM.sendBtn.disabled = !enabled;
  DOM.endBtn.disabled = !enabled;
  if (enabled) DOM.raInput.focus();
}

/* ============================================================
   API
   ============================================================ */

async function call(model, messages) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, temperature: 0.8, max_tokens: 200 }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error?.message || "API error");
  const m = data.choices[0].message;
  return (m.content || m.reasoning || "").trim();
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

function determineNextSpeaker(raText, expectedNext) {
  const lower = raText.toLowerCase();
  const alexWords = ["\balex\b", "\balexandra\b"];
  const jordanWords = ["\bjordan\b"];
  if (alexWords.some(w => new RegExp(w, "i").test(raText))) return "Alex";
  if (jordanWords.some(w => new RegExp(w, "i").test(raText))) return "Jordan";
  return expectedNext;
}

function checkAutoEnd(cleanText, speaker) {
  // Only count as agreement if resident CONFIRMS a specific plan, not just mentions "agree" loosely
  const confirmPatterns = [
    /yes,? i('|\s)?ll? (do|try|use)/i,
    /(that|this) works for me/i,
    /i('|\s)?m (good|happy|fine) with (that|this|it)/i,
    /(let|can we) (commit|start|try|go|begin)/i,
    /i agree (with|to) (this|that|the|your)/i,
    /that (sounds|seems) (fair|reasonable|good)/i,
    /i(\'m|\s+willing|\s+going)\s+to\s+(try|use|do|follow)/i,
    /sounds (good|fair|reasonable)/i,
    /deal,?\s*(we|let)/i,
  ];
  const lower = cleanText.toLowerCase();
  const matched = confirmPatterns.find(p => p.test(cleanText));
  if (matched) {
    console.log(`[AutoEnd] ${speaker} CONFIRMED via pattern: "${matched}"`);
    if (speaker === "Alex") session.alexAgreed = true;
    if (speaker === "Jordan") session.jordanAgreed = true;
    if (session.alexAgreed && session.jordanAgreed) {
      console.log("[AutoEnd] BOTH confirmed! Suggesting end.");
      return true;
    }
  }
  console.log(`[AutoEnd] ${speaker} did NOT confirm. alex=${session.alexAgreed}, jordan=${session.jordanAgreed}`);
  return false;
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
  session.nextSpeaker = "Alex";
  session.alexAgreed = false;
  session.jordanAgreed = false;
  session.turnCount = 0;

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
  renderCards(profiles);

  DOM.chatLog.appendChild(sysEl("Session started."));
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
    session.nextSpeaker = "Jordan";
    scrollToBottom();

    showLoading();
    const jordanRaw = await call(MAIN_MODEL, [{ role: "system", content: jordanPrompt(session.topic, session.difficulty, profiles, alexText) }]);
    hideLoading();
    const jordanText = cleanResponse(jordanRaw);
    console.log("[Jordan raw]", jordanRaw);
    console.log("[Jordan clean]", jordanText);
    DOM.chatLog.appendChild(msgEl("Jordan", jordanText, "jordan"));
    session.turnHistory.push({ sender: "Jordan", text: jordanText });
    session.nextSpeaker = "Alex";
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
  if (!text || !session.active) return;

  DOM.chatLog.appendChild(msgEl(session.raName, text, "ra"));
  session.turnHistory.push({ sender: session.raName, text });
  DOM.raInput.value = "";
  setInput(false);
  showLoading();
  scrollToBottom();

  session.turnCount++;
  const expectedNext = session.nextSpeaker;
  console.log("[Routing] RA said:", text, "| expected:", expectedNext);

  try {
    const raw = await call(MAIN_MODEL, [{ role: "system", content: mediationPrompt(session.topic, session.difficulty, session.turnHistory, session.nextSpeaker, session.turnCount) }]);
    hideLoading();
    const cleanText = cleanResponse(raw);
    console.log("[Response raw]", raw);
    console.log("[Response clean]", cleanText);

    const speaker = session.nextSpeaker;
    const type = speaker.toLowerCase() === "alex" ? "alex" : "jordan";

    if (checkAutoEnd(cleanText, speaker)) {
      DOM.chatLog.appendChild(sysEl("It looks like you have reached an agreement. Click End & Debrief to finish."));
    }

    DOM.chatLog.appendChild(msgEl(speaker, cleanText, type));
    session.turnHistory.push({ sender: speaker, text: cleanText });

    const next = determineNextSpeaker(text, speaker === "Alex" ? "Jordan" : "Alex");
    console.log("[Routing] Next speaker:", next);
    session.nextSpeaker = next;
    setInput(true);
    scrollToBottom();
  } catch (err) {
    hideLoading();
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
          const raw = await call(g.id, [{ role: "system", content: graderPrompt(g.name, session.topic, session.difficulty, session.turnHistory) }]);
          console.log(`[Grader ${g.name} FULL RAW]:`, raw);
          const parsed = parseGrading(raw, g.name);
          console.log(`[Grader ${g.name} PARSED]:`, parsed);
          return parsed;
        } catch (e) {
          console.error(`[Grader ${g.name} FAILED]:`, e.message);
          return { model: g.name, score: 0, strengths: ["Grading failed: " + e.message], gaps: ["Check API key or model availability"] };
        }
      })
    );

    renderGraderCards(results);

    DOM.consolidated.innerHTML = '<div class="message system"><div class="msg-body">Consolidating feedback...</div></div>';
    const consolidatedRaw = await call(CONSOLIDATOR_MODEL, [{ role: "system", content: consolidatorPrompt(results, session.turnHistory) }]);
    renderConsolidated(consolidatedRaw);
  } catch (err) {
    DOM.consolidated.innerHTML = `<div class="section-block">Error: ${esc(err.message)}</div>`;
    console.error(err);
  }
}

/* ============================================================
   GRADING
   ============================================================ */

function parseGrading(raw, name) {
  console.log(`[parseGrading ${name}] input:`, raw.substring(0, 300));
  const scoreMatch = raw.match(/SCORE[:\s]+(\d+)/i);
  const score = scoreMatch ? parseInt(scoreMatch[1]) : 0;
  const strengths = [];
  const gaps = [];
  let section = null;
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (/^STRENGTHS[:\s]/i.test(t)) { section = "s"; continue; }
    if (/^GAPS[:\s]/i.test(t)) { section = "g"; continue; }
    if (t.startsWith("- ") && section) {
      (section === "s" ? strengths : gaps).push(t.slice(2));
    } else if (t.startsWith("* ") && section) {
      (section === "s" ? strengths : gaps).push(t.slice(2));
    }
  }
  console.log(`[parseGrading ${name}] score=${score}, strengths=${strengths.length}, gaps=${gaps.length}`);
  return {
    model: name,
    score,
    strengths: strengths.length ? strengths : ["(No specific strengths parsed)"],
    gaps: gaps.length ? gaps : ["(No specific gaps parsed)"],
  };
}

function renderGraderCards(gradings) {
  DOM.graderCards.innerHTML = gradings.map(g => `
    <div class="grader-card">
      <div class="grader-name">${g.model}</div>
      <div class="grader-score">${g.score}</div>
      <div class="grader-note">out of 100</div>
      <ul>${g.strengths.map(s => `<li>${esc(s)}</li>`).join("")}</ul>
      <div class="grader-note" style="margin-top:8px;">Gaps:</div>
      <ul>${g.gaps.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
    </div>
  `).join("");
}

function renderConsolidated(raw) {
  const lines = raw.split("\n");
  let sections = [];
  let cur = null;

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;

    if (/^OVERALL SCORE:/i.test(t)) {
      const m = t.match(/(\d+)/);
      sections.push({ type: "score", value: m ? m[1] : "N/A" });
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

  let html = "";
  for (const s of sections) {
    if (s.type === "score") {
      html += `<div class="score-display"><div class="score-number">${s.value}/100</div><div class="score-label">Overall Score</div></div>`;
    } else if (s.type === "next") {
      html += `<div class="section-block"><h3>${s.title}</h3><ul>${s.items.map(i => `<li>${esc(i)}</li>`).join("")}</ul></div>`;
    } else if (s.items.length > 0) {
      html += `<div class="section-block"><h3>${s.title}</h3><ul>${s.items.map(i => `<li>${esc(i)}</li>`).join("")}</ul></div>`;
    } else {
      html += `<div class="section-block"><h3>${s.title}</h3><p>${esc(s.title)} section empty</p></div>`;
    }
  }

  if (!html) {
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

const API_URL = "/api/chat";
const MAIN_MODEL = "deepseek/deepseek-chat";
  const GRADER_MODELS = [
  { id: "deepseek/deepseek-chat",        name: "DeepSeek" },
  { id: "moonshotai/kimi-k3.1-pro",      name: "Kimi" },
  { id: "google/gemini-2.5-flash",       name: "Gemini" },
];

const HINTS = [
  "Ask each resident how they feel about the situation.",
  "Restate what you heard each person say to show understanding.",
  "Ask what solution each person would be willing to try.",
  "Look for common ground between both perspectives.",
  "Check if both sides agree on a specific plan going forward.",
  "Ask Alex what would help them feel better in the room.",
  "Ask Jordan what would help them feel respected.",
  "Propose a compromise and ask for feedback from both.",
];
const CONSOLIDATOR_MODEL = "deepseek/deepseek-chat";

const $ = id => document.getElementById(id);

const DOM = {
  setup:           $("setup"),
  chatView:        $("chat-view"),
  debriefView:     $("debrief-view"),
  raNameInput:     $("ra-name"),
  topicSelect:     $("topic-select"),
  difficultySelect: $("difficulty"),
  startBtn:        $("start-btn"),
  raNameDisplay:   $("ra-name-display"),
  topicBadge:      $("topic-badge"),
  difficultyBadge: $("difficulty-badge"),
  residentCards:   $("resident-cards"),
  chatLog:         $("chat-log"),
  raInput:         $("ra-input"),
  sendBtn:         $("send-btn"),
  endBtn:          $("end-btn"),
  debriefRaName:   $("debrief-ra-name"),
  debriefTopic:    $("debrief-topic"),
  debriefDifficulty: $("debrief-difficulty"),
  graderCards:     $("grader-cards"),
  consolidated:    $("consolidated-content"),
  restartBtn:      $("restart-btn"),
};

let session = {
  raName: "",
  topic: "noise",
  difficulty: "medium",
  messages: [],
  turnHistory: [],
  active: false,
  nextSpeaker: "Alex",
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
    alex: { name: "Alex", handle: "@alex.bio26", meta: "20 · Junior · Biology", trait: "Early riser. Needs structure and quiet.", mood: t.alex, stance: s.alex },
    jordan: { name: "Jordan", handle: "@jordan.comm25", meta: "19 · Sophomore · Communications", trait: "Night owl. Social, values freedom.", mood: t.jordan, stance: s.jordan },
  };
}

function renderCards(profiles) {
  DOM.residentCards.innerHTML = `
    <div class="resident-card alex">
      <div class="card-header">
        <span class="card-name">${profiles.alex.name}</span>
        <span class="card-handle">${profiles.alex.handle}</span>
      </div>
      <div class="card-meta">${profiles.alex.meta}</div>
      <div class="card-trait">${profiles.alex.trait}</div>
      <div class="card-stance">${profiles.alex.stance}</div>
    </div>
    <div class="resident-card jordan">
      <div class="card-header">
        <span class="card-name">${profiles.jordan.name}</span>
        <span class="card-handle">${profiles.jordan.handle}</span>
      </div>
      <div class="card-meta">${profiles.jordan.meta}</div>
      <div class="card-trait">${profiles.jordan.trait}</div>
      <div class="card-stance">${profiles.jordan.stance}</div>
    </div>
  `;
}

/* ============================================================
   PROMPTS
   ============================================================ */

function alexPrompt(topic, difficulty, profile) {
  const d = { easy: "cooperative", medium: "frustrated", hard: "very upset" }[difficulty];
  return `You are Alex. Profile: ${profile.alex.meta}. ${profile.alex.trait} Current mood: ${profile.alex.mood}.

The issue: ${profile.alex.stance}

This is your FIRST message to the RA. In exactly 2 short paragraphs:

Paragraph 1: Introduce yourself (name, year, major) and state the problem briefly.
Paragraph 2: Explain how this affects you and end with one question for the RA.

Difficulty: ${difficulty} (you are ${d}).
Do NOT include "Alex:" at the start. Do NOT mention Jordan by name yet.`;
}

function jordanPrompt(topic, difficulty, profile, alexMsg) {
  const d = { easy: "cooperative", medium: "frustrated", hard: "very upset" }[difficulty];
  return `You are Jordan. Profile: ${profile.jordan.meta}. ${profile.jordan.trait} Current mood: ${profile.jordan.mood}.

The issue: ${profile.jordan.stance}

Alex just said: "${alexMsg}"

The RA is now asking for your side. In exactly 2 short paragraphs:

Paragraph 1: Introduce yourself (name, year, major) and state the problem from your view.
Paragraph 2: Push back on Alex's version without being hostile, and end with how you feel.

Difficulty: ${difficulty} (you are ${d}).
Do NOT include "Jordan:" at the start.`;
}

function mediationPrompt(topic, difficulty, history, nextSpeaker) {
  const d = { easy: "cooperative", medium: "frustrated", hard: "very upset and resistant" }[difficulty];

  const transcript = history.map(h => `${h.sender}: ${h.text}`).join("\n");

  return `You are ${nextSpeaker} in a roommate conflict about ${topic}.
Difficulty: ${difficulty} (you are ${d}).

CONVERSATION:
${transcript}

The RA just spoke. Respond as ${nextSpeaker} in 2-4 sentences.
Rules:
- Address the RA directly
- Stay in your character (Alex: structured, needs quiet / Jordan: social, needs freedom)
- If RA was helpful, soften slightly but do not agree instantly
- If RA was unhelpful, push back
- Do NOT resolve the conflict yourself

Do NOT include "**${nextSpeaker}:**" at the start. Speak naturally.`;
}

function graderPrompt(modelName, topic, difficulty, history) {
  const transcript = history.map(h => `${h.sender}: ${h.text}`).join("\n");
  return `You are an experienced RA supervisor grading a mediation practice session.

IMPORTANT: Grade the MEDIATOR (the RA), NOT the residents. Focus on how well the RA facilitated the conversation, listened, validated feelings, and proposed solutions.

Situation: ${topic} / Difficulty: ${difficulty}

TRANSCRIPT:
${transcript}

Respond ONLY in this format:
SCORE: [number]/100
STRENGTHS:
- [specific strength of the MEDIATOR]
- [specific strength of the MEDIATOR]
GAPS:
- [specific gap of the MEDIATOR]
- [specific gap of the MEDIATOR]

No em dashes. Plain language. Focus on the MEDIATOR'S performance, not the residents.`;
}

function consolidatorPrompt(gradings, history) {
  const g = gradings.map((gr, i) => `GRADER ${i + 1} (${gr.model}): ${gr.score}/100\nStrengths:\n${gr.strengths.map(s => "- " + s).join("\n")}\nGaps:\n${gr.gaps.map(g => "- " + g).join("\n")}`).join("\n\n");

  return `Three AI supervisors graded the same RA mediation. Consolidate into one debrief.

${g}

Output EXACTLY in this format:

OVERALL SCORE: [round average of three scores]/100

WHAT YOU DID WELL:
- [specific action, with moment reference]
- [specific action, with moment reference]
- [specific action, with moment reference]

WHAT YOU MISSED:
- [specific gap, with what to do instead]
- [specific gap, with what to do instead]
- [specific gap, with what to do instead]

ONE THING TO TRY NEXT TIME:
- [One concrete technique for the MEDIATOR]

Rules:
- NO em dashes. Use periods, commas, colons, or hyphens only.
- Concise and action-oriented.
- Reference specific transcript moments.
- Do not repeat the same point.
- ALL feedback must be about the MEDIATOR'S performance, not the residents.`;
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
  div.appendChild(document.createElement("div")).className = "msg-body";
  div.querySelector(".msg-body").textContent = text;
  return div;
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
    body: JSON.stringify({ model, messages, temperature: 0.8, max_tokens: 300 }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error?.message || "API error");
  const m = data.choices[0].message;
  return (m.content || m.reasoning || "").trim();
}

function determineNextSpeaker(raText, expectedNext) {
  const lower = raText.toLowerCase();
  if (lower.includes("alex")) return "Alex";
  if (lower.includes("jordan")) return "Jordan";
  return expectedNext;
}

function cleanResponse(raw) {
  const m = raw.match(/^\*\*?\w+\*\*?[\s:]+(.+)$/s);
  return m ? m[1].trim() : raw.trim();
}

function checkAutoEnd(cleanText, speaker) {
  const agreeWords = ["agree", "deal", "works for me", "sounds good", "fair enough", "okay", "fine", "that works", "i'm good with", "let's do"];
  const lower = cleanText.toLowerCase();
  if (agreeWords.some(w => lower.includes(w))) {
    if (speaker === "Alex") session.alexAgreed = true;
    if (speaker === "Jordan") session.jordanAgreed = true;
    if (session.alexAgreed && session.jordanAgreed) {
      return true;
    }
  }
  return false;
}

/* ============================================================
   SESSION FLOW
   ============================================================ */

async function startSession() {
  session.raName = DOM.raNameInput.value.trim() || "You";
  session.topic = DOM.topicSelect.value;
  session.difficulty = DOM.difficultySelect.value;
  session.messages = [];
  session.turnHistory = [];
  session.active = true;
  session.nextSpeaker = "Alex";
  session.alexAgreed = false;
  session.jordanAgreed = false;

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
    // Alex introduces
    const alexRaw = await call(MAIN_MODEL, [{ role: "system", content: alexPrompt(session.topic, session.difficulty, profiles) }]);
    const alexText = cleanResponse(alexRaw);
    DOM.chatLog.appendChild(msgEl("Alex", alexText, "alex"));
    session.turnHistory.push({ sender: "Alex", text: alexText });
    session.nextSpeaker = "Jordan";
    scrollToBottom();

    // Jordan introduces
    const jordanRaw = await call(MAIN_MODEL, [{ role: "system", content: jordanPrompt(session.topic, session.difficulty, profiles, alexText) }]);
    const jordanText = cleanResponse(jordanRaw);
    DOM.chatLog.appendChild(msgEl("Jordan", jordanText, "jordan"));
    session.turnHistory.push({ sender: "Jordan", text: jordanText });
    session.nextSpeaker = "Alex";
    scrollToBottom();

    DOM.chatLog.appendChild(sysEl("Both residents have shared their sides. Begin mediating."));
    setInput(true);
  } catch (err) {
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
  scrollToBottom();

  try {
    const raw = await call(MAIN_MODEL, [{ role: "system", content: mediationPrompt(session.topic, session.difficulty, session.turnHistory, session.nextSpeaker) }]);
    const cleanText = cleanResponse(raw);
    const speaker = session.nextSpeaker;
    const type = speaker.toLowerCase() === "alex" ? "alex" : "jordan";

    if (checkAutoEnd(cleanText, speaker)) {
      DOM.chatLog.appendChild(sysEl("It looks like you have reached an agreement. Click End & Debrief to finish."));
    }

    DOM.chatLog.appendChild(msgEl(speaker, cleanText, type));
    session.turnHistory.push({ sender: speaker, text: cleanText });

    session.nextSpeaker = determineNextSpeaker(text, speaker === "Alex" ? "Jordan" : "Alex");
    setInput(true);
    scrollToBottom();
  } catch (err) {
    DOM.chatLog.appendChild(sysEl(`Error: ${err.message}. Try again.`));
    setInput(true);
    console.error(err);
  }
}

async function end() {
  if (!session.active) return;
  session.active = false;
  setInput(false);

  DOM.chatView.classList.add("hidden");
  DOM.debriefView.classList.remove("hidden");
  DOM.debriefRaName.textContent = session.raName;
  DOM.debriefTopic.textContent = toTitleCase(session.topic);
  DOM.debriefDifficulty.textContent = toTitleCase(session.difficulty);
  DOM.consolidated.innerHTML = '<div class="message system"><div class="msg-body">Sending to 3 AI graders. This takes 10-20 seconds.</div></div>';

  try {
    // Grade in parallel
    const results = await Promise.all(
      GRADER_MODELS.map(async g => {
        try {
          const raw = await call(g.id, [{ role: "system", content: graderPrompt(g.name, session.topic, session.difficulty, session.turnHistory) }]);
          return parseGrading(raw, g.name);
        } catch (e) {
          return { model: g.name, score: 0, strengths: ["Grading failed"], gaps: [e.message] };
        }
      })
    );

    renderGraderCards(results);

    DOM.consolidated.innerHTML = '<div class="message system"><div class="msg-body">Consolidating feedback...</div></div>';
    const consolidatedRaw = await call(CONSOLIDATOR_MODEL, [{ role: "system", content: consolidatorPrompt(results, session.turnHistory) }]);
    renderConsolidated(consolidatedRaw);
  } catch (err) {
    DOM.consolidated.innerHTML = `<p class="message system"><div class="msg-body">Error: ${err.message}</div></p>`;
    console.error(err);
  }
}

function parseGrading(raw, name) {
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
    }
  }
  return { model: name, score, strengths: strengths.length ? strengths : ["No specific strengths noted"], gaps: gaps.length ? gaps : ["No specific gaps noted"] };
}

function renderGraderCards(gradings) {
  DOM.graderCards.innerHTML = gradings.map(g => `
    <div class="grader-card">
      <div class="grader-name">${g.model}</div>
      <div class="grader-score">${g.score}</div>
      <div class="grader-note">out of 100</div>
      <ul>${g.strengths.map(s => `<li>${esc(s)}</li>`).join("")}</ul>
      <div class="grader-note" style="margin-top:8px;">Gaps:</div>
      <ul>${g.gaps.map(g => `<li>${esc(g)}</li>`).join("")}</ul>
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
    } else if (t.startsWith("- ") && cur) {
      cur.items.push(t.slice(2));
    } else if (cur && cur.type === "next" && cur.items.length === 0) {
      cur.items.push(t);
    } else if (cur) {
      cur.items[cur.items.length - 1] += " " + t;
    }
  }

  let html = "";
  for (const s of sections) {
    if (s.type === "score") {
      html += `<div class="score-display"><div class="score-number">${s.value}/100</div><div class="score-label">Overall Score</div></div>`;
    } else if (s.type === "next") {
      html += `<div class="section-block"><h3>${s.title}</h3><ul><li>${esc(s.items.join(" "))}</li></ul></div>`;
    } else {
      html += `<div class="section-block"><h3>${s.title}</h3><ul>${s.items.map(i => `<li>${esc(i)}</li>`).join("")}</ul></div>`;
    }
  }

  DOM.consolidated.innerHTML = html || `<div class="section-block">${esc(raw).replace(/\n/g, "<br>")}</div>`;
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

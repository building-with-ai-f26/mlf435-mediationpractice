import { isMockMode, getResponder, commitTurn, mediationPrompt, buildRequestBody, extractContent, cleanResponse, bothAgreed, shouldShowAgreementNotice, isTurnCapReached, formatUsage } from "./logic.js";
import { mockResponse } from "./mock.js";
import { MAIN_MODEL, GRADER_MODELS, TOKENS_RESIDENT, GRADER_OPTS, MAX_TURNS, getProfiles, alexPrompt, jordanPrompt, createSession } from "./config.js";
import { RUBRIC, buildRubricPrompt, parseRubricReply, verifyEvidence, combineGraders, scoreFromCombined, coachingSummary } from "./rubric.js";

const API_URL = "/api/chat";
// ?mock=1, or any *.github.io host, serves canned replies and grades. No fetch, no API key, no cost.
const MOCK = isMockMode(location.hostname, location.search);
if (MOCK) document.getElementById("demo-banner").hidden = false;

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

let session = createSession();

/* ============================================================
   CARDS
   ============================================================ */

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

async function call(model, messages, opts = { maxTokens: TOKENS_RESIDENT }) {
  let data;
  if (MOCK) {
    await new Promise(r => setTimeout(r, 150));
    data = mockResponse(model, messages);
  } else {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildRequestBody(model, messages, opts)),
    });
    try {
      data = await res.json();
    } catch {
      throw new Error(`The server sent an unreadable reply (status ${res.status}). Check that it is running.`);
    }
    if (!res.ok || data.error) throw new Error(data.error?.message || "API error");
  }
  console.log(formatUsage(model, data.usage));
  if (data.choices?.[0]?.finish_reason === "length") {
    console.warn(`[call] Model ${model} response truncated (finish_reason: length)`);
  }
  try {
    return extractContent(data);
  } catch (e) {
    e.finishReason = data.choices?.[0]?.finish_reason;
    throw e;
  }
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
    const prompt = buildRubricPrompt(session.topic, session.difficulty, session.turnHistory, session.raName);
    const results = await Promise.all(
      GRADER_MODELS.map(async g => {
        try {
          const raw = await call(g.id, [{ role: "system", content: prompt }], GRADER_OPTS);
          console.log(`[Grader ${g.name} FULL RAW]:`, raw);
          const parsed = parseRubricReply(raw);
          if (!parsed.ok) throw new Error("the reply could not be read as 15 yes/no lines");
          const verified = verifyEvidence(parsed.answers, session.turnHistory);
          if (verified.changed.length) console.warn(`[Grader ${g.name}] YES changed to NO, quote not found in RA messages: Q${verified.changed.join(", Q")}`);
          return { name: g.name, ok: true, answers: verified.answers };
        } catch (e) {
          const finish = e.finishReason ?? "none (no reply received)";
          console.error(`[Grader ${g.name} FAILED]: ${e.message} (finish_reason: ${finish})`);
          return { name: g.name, ok: false, answers: {}, error: `${e.message} (finish_reason: ${finish})` };
        }
      })
    );
    renderDebrief(results);
  } catch (err) {
    DOM.consolidated.innerHTML = `<div class="section-block">Error: ${esc(err.message)}</div>`;
    console.error(err);
  }
}

/* ============================================================
   GRADING
   ============================================================ */

const REFLECTION_QUESTIONS = [
  "Would this conflict need to be escalated to your BLT? Why or why not?",
  "How would you manage this incident differently if there were communication barriers between roommates?",
];

function renderDebrief(results) {
  const valid = results.filter(r => r.ok);
  DOM.graderCards.innerHTML = results.map(r => `
    <div class="grader-chip${r.ok ? "" : " failed"}">
      <span class="grader-name">${esc(r.name)}</span>
      <span class="grader-detail">${r.ok ? `${Object.values(r.answers).filter(a => a.yes).length} of ${RUBRIC.length} met` : esc(r.error)}</span>
    </div>`).join("");

  let html = "";
  if (valid.length === 0) {
    html += '<div class="score-display"><div class="score-label">Score unavailable</div></div>';
  } else {
    const combined = combineGraders(results);
    const { met, total, score } = scoreFromCombined(combined);
    html += `<div class="score-display"><div class="score-number">${met} of ${total}</div><div class="score-label">${score}% of checklist items met</div>`;
    if (valid.length < 2) html += `<div class="grader-note">Score based on ${valid.length} grader${valid.length === 1 ? "" : "s"}</div>`;
    html += "</div>";

    const groups = [...new Set(RUBRIC.map(q => q.group))];
    for (const group of groups) {
      html += `<div class="section-block"><h3>${esc(group)}</h3><ul class="rubric-list">`;
      for (const q of RUBRIC.filter(x => x.group === group)) {
        const c = combined.find(x => x.id === q.id);
        const agree = c.met ? c.votes : valid.length - c.votes;
        html += `<li class="rubric-item ${c.met ? "met" : "missed"}">
          <span class="rubric-mark" aria-label="${c.met ? "Met" : "Missed"}">${c.met ? "\u2713" : "\u2717"}</span>
          <div class="rubric-body">
            <div class="rubric-q">${esc(q.text)}</div>
            ${c.met
              ? `<div class="rubric-evidence">You said: "${esc(c.quote)}"</div>`
              : `<div class="rubric-tip">Tip: ${esc(q.tip)}</div>`}
            <div class="rubric-agree">${agree} of ${valid.length} grader${valid.length === 1 ? "" : "s"} said ${c.met ? "yes" : "no"}</div>
          </div></li>`;
      }
      html += "</ul></div>";
    }

    const { nextTip } = coachingSummary(combined);
    html += `<div class="section-block"><h3>One thing to try next time</h3><p>${nextTip ? esc(nextTip) : "You met every item on the checklist. Keep doing what you did."}</p></div>`;
  }

  html += `<div class="section-block"><h3>Reflection (not scored)</h3><ul>${REFLECTION_QUESTIONS.map(q => `<li>${esc(q)}</li>`).join("")}</ul></div>`;
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

import { isMockMode, routeMessage, bothOrder, buildRouterPrompt, parseRouterReply, commitReplies, mediationPrompt, buildRequestBody, extractContent, cleanResponse, buildTaggerPrompt, parseTags, updateOpenness, startingOpenness, bothAgreed, proposalStanding, resolutionState, isTurnCapReached, formatUsage, getAppMode, formatBuildLabel, decodeIdToken, isTokenValid, getEnvName, facilitatorName, cleanFacilitatorName } from "./logic.js";
import { mockResponse, mockRoute } from "./mock.js";
import { RESIDENT_MODEL, applyServerModels, GRADER_MODELS, RESIDENT_OPTS, graderOpts, TAGGER_MODEL, TAGGER_OPTS, ROUTER_MODEL, ROUTER_OPTS, MAX_TURNS, getProfiles, alexPrompt, jordanPrompt, createSession } from "./config.js";
import { newLiveLog, addUsage, buildLiveRecord } from "./liveRecord.js";
import { normalizeMode, readStoredMode, writeStoredMode, readStoredMuted, writeStoredMuted, ttsText, estimateDurationMs, revealFraction, revealText, createLiveLine } from "./voice.js";
import { RUBRIC, RUBRIC_VERSION, buildRubricPrompt, parseRubricReply, verifyEvidence, combineGraders, scoreFromCombined, coachingSummary } from "./rubric.js";

const API_URL = "/api/chat";
// The model ids are set on the server (environment). Ask for them once; the defaults in config.js are used if this fails (demo, mock).
const configReady = MOCK_FOR_CONFIG();
function MOCK_FOR_CONFIG() {
  if (isMockMode(location.hostname, location.search)) return Promise.resolve();
  return fetch("/config.json").then(r => (r.ok ? r.json() : null)).then(c => { applyServerModels(c); }).catch(() => {});
}
// ?mock=1, or any *.github.io host, serves canned replies and grades. No fetch, no API key, no cost.
const MOCK = isMockMode(location.hostname, location.search);
if (MOCK) document.getElementById("demo-banner").hidden = false;

// Analytics. Never throws: a blocked or failed PostHog must not break the app.
// Callers pass counts and labels only, never message text, the RA's name or transcripts.
function track(event, props) {
  try { window.posthog && window.posthog.capture(event, props); } catch (e) { /* ignore */ }
}
try { window.posthog && window.posthog.register({ app_mode: getAppMode(location.hostname, location.search), env: getEnvName(location.hostname) }); } catch (e) { /* ignore */ }

/* ============================================================
   GOOGLE SIGN-IN (live mode only; mock and the demo skip it)
   ============================================================ */

const TOKEN_KEY = "ra_id_token";
let idToken = null;
try { idToken = sessionStorage.getItem(TOKEN_KEY); } catch (e) { /* ignore */ }
if (idToken && !isTokenValid(idToken, Date.now())) idToken = null;
let gsiStarted = false;

function setSignInMessage(text) { const el = document.getElementById("signin-message"); if (el) el.textContent = text; }

function showSignIn(message) {
  if (MOCK) return;
  setSignInMessage(message || "");
  document.getElementById("signin").hidden = false;
  document.getElementById("user-bar").hidden = true;
  initGoogle();
}

function hideSignIn() {
  document.getElementById("signin").hidden = true;
  const given = cleanFacilitatorName(decodeIdToken(idToken)?.given_name);
  document.getElementById("user-greeting").textContent = given ? `Signed in as ${given}` : "Signed in";
  document.getElementById("user-bar").hidden = false;
}

function onCredential(response) {
  const token = response && response.credential;
  if (!isTokenValid(token, Date.now())) { setSignInMessage("That sign-in did not work. Please try again."); return; }
  idToken = token;
  try { sessionStorage.setItem(TOKEN_KEY, token); } catch (e) { /* ignore */ }
  // Only the Google account id (sub) goes to PostHog, never the email or name.
  try {
    const sub = decodeIdToken(token)?.sub;
    if (sub && window.posthog) window.posthog.identify(String(sub));
  } catch (e) { /* ignore */ }
  hideSignIn();
}

function signOut() {
  idToken = null;
  try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
  try { window.google?.accounts?.id?.disableAutoSelect(); } catch (e) { /* ignore */ }
  try {
    if (window.posthog) {
      window.posthog.reset();
      window.posthog.register({ app_mode: getAppMode(location.hostname, location.search), env: getEnvName(location.hostname) });
    }
  } catch (e) { /* ignore */ }
  showSignIn("");
}

async function initGoogle() {
  if (gsiStarted) return;
  let clientId = "";
  try {
    const r = await fetch("/config.json");
    clientId = r.ok ? (await r.json()).googleClientId || "" : "";
  } catch (e) { /* ignore */ }
  if (!clientId) { setSignInMessage("Sign-in is not set up on this server."); return; }
  const start = () => {
    if (gsiStarted) return;
    gsiStarted = true;
    window.google.accounts.id.initialize({ client_id: clientId, callback: onCredential });
    window.google.accounts.id.renderButton(document.getElementById("google-button"), { theme: "outline", size: "large", text: "signin_with" });
  };
  if (window.google?.accounts?.id) start();
  else {
    // The GSI script is async: Google calls this hook when it finishes loading.
    window.onGoogleLibraryLoad = start;
    setTimeout(() => { if (!gsiStarted && window.google?.accounts?.id) start(); }, 1500);
  }
}

// fetch with the Bearer token. A 401 clears the token and shows the sign-in screen over the page.
function authFetch(url, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  return fetch(url, { ...opts, headers }).then(res => {
    if (res.status === 401) {
      idToken = null;
      try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
      showSignIn("Your sign-in expired. Sign in again to continue.");
    }
    return res;
  });
}

document.getElementById("sign-out-link").addEventListener("click", e => { e.preventDefault(); signOut(); });
if (!MOCK) { if (idToken) hideSignIn(); else showSignIn(""); }
if (!MOCK && idToken) { try { const sub = decodeIdToken(idToken)?.sub; if (sub && window.posthog) window.posthog.identify(String(sub)); } catch (e) { /* ignore */ } }

// Footer build label from /healthz. Silent on any failure (demo and mock hosts have no /healthz).
fetch("/healthz").then(r => r.ok ? r.json() : null).then(h => {
  const label = formatBuildLabel(h);
  const el = document.getElementById("build-footer");
  if (label && el) { el.textContent = label; el.hidden = false; }
}).catch(() => {});

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
  modeText: $("mode-text"), modeVoice: $("mode-voice"), voiceHint: $("voice-hint"), voiceBar: $("voice-bar"), muteBtn: $("mute-btn"),
};

// Practice mode setting: remembered between sessions, Text the first time. Voice needs the live server.
if (MOCK) {
  DOM.modeVoice.disabled = true;
  DOM.voiceHint.textContent = "Voice needs the live server, so it is off in the demo.";
  DOM.voiceHint.hidden = false;
} else {
  (readStoredMode(localStorage) === "voice" ? DOM.modeVoice : DOM.modeText).checked = true;
}
function showVoiceHint() {
  if (MOCK) return;
  DOM.voiceHint.hidden = !DOM.modeVoice.checked;
}
DOM.modeText.addEventListener("change", showVoiceHint);
DOM.modeVoice.addEventListener("change", showVoiceHint);
showVoiceHint();
DOM.muteBtn.addEventListener("click", () => setMuted(!practice.muted));

/* ============================================================
   PRACTICE MODE AND READ-ALOUD (voice mode only; text mode never touches any of this)
   The mode changes only how a reply is shown and heard. The stored message, the grading and the model prompts are the same.
   ============================================================ */

const practice = { mode: "text", muted: false, audioOk: true };
const clipUrls = []; // object URLs for this session's audio, revoked when a new session starts
let currentPlayback = null; // { stop() } while a clip is playing

function setMuted(muted) {
  practice.muted = muted;
  writeStoredMuted(localStorage, muted);
  DOM.muteBtn.textContent = muted ? "Unmute" : "Mute";
  DOM.muteBtn.setAttribute("aria-pressed", String(muted));
  document.querySelectorAll(".play-btn").forEach(b => { b.disabled = muted; });
  if (muted) currentPlayback?.stop();
}

async function fetchClip(resident, text) {
  const res = await authFetch("/api/tts", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: ttsText(text), resident }),
  });
  if (!res.ok) {
    let msg = `status ${res.status}`;
    try { msg = (await res.json()).error?.message || msg; } catch (e) { /* ignore */ }
    throw new Error(msg);
  }
  const url = URL.createObjectURL(await res.blob());
  clipUrls.push(url);
  return url;
}

// Plays a clip. With a live line, the text is revealed in step with the speech. Resolves when the clip ends, fails or is stopped.
function playClip(url, text, line) {
  return new Promise(resolve => {
    const audio = new Audio(url);
    let done = false, raf = 0;
    const finish = () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf); clearTimeout(guard);
      audio.pause();
      if (currentPlayback === handle) currentPlayback = null;
      line?.finish(text);
      document.querySelectorAll(".play-btn.playing").forEach(b => { b.classList.remove("playing"); b.textContent = "Play"; });
      scrollToBottom();
      resolve();
    };
    const handle = { stop: finish };
    currentPlayback?.stop();
    currentPlayback = handle;
    const guard = setTimeout(finish, 90000);
    audio.addEventListener("ended", finish);
    audio.addEventListener("error", finish);
    const tick = () => {
      if (done) return;
      if (line) {
        const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : estimateDurationMs(text);
        line.update(revealText(text, revealFraction(audio.currentTime * 1000, dur)));
        scrollToBottom();
      }
      raf = requestAnimationFrame(tick);
    };
    // A blocked autoplay rejects here: the text is shown at once and the play button still works.
    audio.play().then(tick, finish);
  });
}

function addPlayButton(line, resident, text) {
  const btn = document.createElement("button");
  btn.className = "play-btn";
  btn.type = "button";
  btn.textContent = "Play";
  btn.disabled = practice.muted;
  btn.setAttribute("aria-label", `Play ${resident === "alex" ? "Alex" : "Jordan"}'s message aloud`);
  let clip = null;
  btn.addEventListener("click", async () => {
    if (btn.classList.contains("playing")) { currentPlayback?.stop(); return; }
    try {
      btn.disabled = true;
      clip ||= await fetchClip(resident, text);
      btn.disabled = practice.muted;
      btn.classList.add("playing"); btn.textContent = "Stop";
      await playClip(clip, text, null);
    } catch (e) {
      btn.disabled = practice.muted;
      DOM.chatLog.appendChild(sysEl(`Audio is not available: ${e.message}`));
      scrollToBottom();
    }
  });
  line.controls.appendChild(btn);
}

// Shows one resident message. Text mode: the message appears at once, exactly as before.
// Voice mode: the message builds word by word while its audio plays. If audio fails, the full text is shown and the session carries on.
// Returns the message element. The stored text is always `text`.
async function showResident(sender, text, resident) {
  if (practice.mode !== "voice") {
    const el = msgEl(sender, text, resident);
    DOM.chatLog.appendChild(el);
    return el;
  }
  const line = createLiveLine(document, { sender, type: resident });
  DOM.chatLog.appendChild(line.el);
  hideLoading();
  scrollToBottom();
  if (!practice.muted && practice.audioOk) {
    try {
      const url = await fetchClip(resident, text);
      await playClip(url, text, line);
    } catch (e) {
      practice.audioOk = false;
      DOM.chatLog.appendChild(sysEl(`Audio is not available (${e.message}). Replies will show as text.`));
    }
  }
  line.finish(text);
  addPlayButton(line, resident, text);
  scrollToBottom();
  return line.el;
}

async function syncServerMode(mode) {
  try {
    const res = await authFetch("/api/practice-mode", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
    return res.ok;
  } catch (e) { return false; }
}

let session = createSession();
// What gets saved at the end of a live session (see saveLive). Reset in startSession().
let live = newLiveLog();

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

// "You reached a plan" notice with a button to end and see feedback. Shown once per session.
function planNoticeEl() {
  const div = sysEl("You reached a plan. Both residents agreed to what, when and a check-in.");
  const btn = document.createElement("button");
  btn.className = "btn btn-small";
  btn.textContent = "End and see feedback";
  btn.addEventListener("click", () => end());
  div.appendChild(btn);
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

// role is only a label for the token counts saved with a live session.
async function call(model, messages, opts = RESIDENT_OPTS, role = "resident") {
  let data;
  if (MOCK) {
    await new Promise(r => setTimeout(r, 150));
    data = mockResponse(model, messages);
  } else {
    const res = await authFetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildRequestBody(model, messages, opts)),
    });
    try {
      data = await res.json();
    } catch {
      throw new Error(`The server sent an unreadable reply (status ${res.status}). Check that it is running.`);
    }
    if (res.status === 401) throw new Error("Your sign-in expired. Sign in again, then retry.");
    if (!res.ok || data.error) throw new Error(data.error?.message || "API error");
  }
  console.log(formatUsage(model, data.usage));
  addUsage(live, role, data.usage);
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
  await configReady;
  // Signed in: the first name from the Google token (cleaned). Otherwise the typed name, or "RA".
  // The saved record still says "RA" (buildLiveRecord scrubs this name).
  const signedInName = MOCK ? "RA" : facilitatorName(idToken, Date.now());
  session.raName = signedInName !== "RA" ? signedInName : (DOM.raNameInput.value.trim() || "RA");
  session.topic = DOM.topicSelect.value;
  session.difficulty = DOM.difficultySelect.value;
  session.turnHistory = [];
  session.active = true;
  session.lastSpeaker = "Jordan";
  session.turnCount = 0;
  session.resolved = false;
  session.resolvedTurn = null;
  session.openness = startingOpenness(session.difficulty);
  live = newLiveLog();
  live.opennessStart = { alex: session.openness.alex, jordan: session.openness.jordan };
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

  track("session_started", { topic: session.topic, difficulty: session.difficulty, mode: !MOCK && DOM.modeVoice.checked ? "voice" : "text" });
  const profiles = getProfiles(session.topic, session.difficulty);
  session.profiles = profiles;
  renderCards(profiles);

  DOM.chatLog.appendChild(sysEl(MOCK ? "Session started. MOCK MODE: canned replies, no API calls." : "Session started."));
  setInput(false);

  // Practice mode. Text is the default and the demo is always text. Tell the server, so it can refuse read-aloud calls in text mode.
  currentPlayback?.stop();
  clipUrls.splice(0).forEach(u => URL.revokeObjectURL(u));
  practice.mode = MOCK ? "text" : normalizeMode(DOM.modeVoice.checked ? "voice" : "text");
  practice.audioOk = true;
  if (!MOCK) {
    writeStoredMode(localStorage, practice.mode);
    const synced = await syncServerMode(practice.mode);
    if (!synced && practice.mode === "voice") {
      practice.mode = "text";
      DOM.chatLog.appendChild(sysEl("Voice mode could not be turned on, so this session is text only."));
    }
  }
  DOM.voiceBar.classList.toggle("hidden", practice.mode !== "voice");
  setMuted(readStoredMuted(localStorage));

  try {
    showLoading();
    const alexRaw = await call(RESIDENT_MODEL, [{ role: "system", content: alexPrompt(session.topic, session.difficulty, profiles, session.raName) }]);
    hideLoading();
    const alexText = cleanResponse(alexRaw);
    console.log("[Alex raw]", alexRaw);
    console.log("[Alex clean]", alexText);
    await showResident("Alex", alexText, "alex");
    session.turnHistory.push({ sender: "Alex", text: alexText });
    scrollToBottom();

    showLoading();
    const jordanRaw = await call(RESIDENT_MODEL, [{ role: "system", content: jordanPrompt(session.topic, session.difficulty, profiles, alexText) }]);
    hideLoading();
    const jordanText = cleanResponse(jordanRaw);
    console.log("[Jordan raw]", jordanRaw);
    console.log("[Jordan clean]", jordanText);
    await showResident("Jordan", jordanText, "jordan");
    session.turnHistory.push({ sender: "Jordan", text: jordanText });
    session.lastSpeaker = "Jordan";
    scrollToBottom();

    DOM.chatLog.appendChild(sysEl("Both residents have shared their sides. Begin mediating."));
    setInput(true);
  } catch (err) {
    hideLoading();
    DOM.chatLog.appendChild(sysEl(`Error: ${err.message}. Refresh to retry.`));
    track("error_shown", { where: "session_start" });
    console.error(err);
  }
}

// Who answers. Names first (pure code). If nobody is clearly addressed, one cheap router call;
// a failed call or a reply that is not ALEX, JORDAN or BOTH falls back to the resident who did not speak last.
// Mock mode never calls a model.
async function decideRoute(text) {
  if (MOCK) return mockRoute(text, session.lastSpeaker);
  const { to } = routeMessage(text, session.lastSpeaker);
  if (to !== "unclear") return { to, source: "code" };
  try {
    const raw = await call(ROUTER_MODEL, [{ role: "system", content: buildRouterPrompt(session.turnHistory, text) }], ROUTER_OPTS, "router");
    const parsed = parseRouterReply(raw, session.lastSpeaker);
    if (parsed.source === "fallback") console.warn("[Routing] router reply not usable:", JSON.stringify(raw));
    return { to: parsed.to, source: parsed.source === "router" ? "router call" : "code (router reply unusable)" };
  } catch (e) {
    console.warn("[Routing] router call failed:", e.message);
    return { to: parseRouterReply("", session.lastSpeaker).to, source: "code (router call failed)" };
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
  track("ra_message_sent", { turn, chars: text.length });
  const shownEls = [];

  try {
    const route = await decideRoute(text);
    const keys = route.to === "both" ? bothOrder(text, session.lastSpeaker) : [route.to];
    const speakers = keys.map(k => (k === "alex" ? "Alex" : "Jordan"));
    console.log("[Routing] RA said:", text, "| responders:", speakers.join(", "), "| source:", route.source);

    // Tag the RA message, then update openness. An unreadable or failed tagger reply changes nothing.
    let tags = null;
    try {
      tags = parseTags(await call(TAGGER_MODEL, [{ role: "system", content: buildTaggerPrompt(session.turnHistory, text, session.profiles) }], TAGGER_OPTS, "tagger"));
    } catch (e) {
      console.warn("[Tagger] failed, openness unchanged:", e.message);
    }
    const openness = updateOpenness(session.openness, tags, session.difficulty);
    console.log("[Tagger]", tags, "openness", openness);
    // One RA message, one or two resident replies in order. The second sees the first.
    // standing: for how many of this resident's turns a plan that keeps their must-haves has been on the table.
    const tagList = [...live.turns.map(t => t.tags), tags];
    const replies = [];
    for (const speaker of speakers) {
      const thread = [...session.turnHistory, raEntry, ...replies];
      const standing = proposalStanding(thread, tagList)[speaker.toLowerCase()];
      const raw = await call(RESIDENT_MODEL, [{ role: "system", content: mediationPrompt(session.topic, session.difficulty, thread, speaker, turn, session.profiles, openness[speaker.toLowerCase()], session.raName, standing) }]);
      const cleanText = cleanResponse(raw);
      console.log("[Response raw]", raw);
      console.log("[Response clean]", cleanText);
      const el = await showResident(speaker, cleanText, speaker.toLowerCase());
      shownEls.push(el);
      replies.push({ sender: speaker, text: cleanText });
      if (speaker !== speakers[speakers.length - 1]) { scrollToBottom(); showLoading(); }
    }
    hideLoading();
    live.turns.push({
      turn, at: new Date().toISOString(), ra: text, replies, route: { to: route.to, responders: speakers, source: route.source },
      tags, opennessBefore: { alex: session.openness.alex, jordan: session.openness.jordan }, opennessAfter: { alex: openness.alex, jordan: openness.jordan },
    });
    commitReplies(session, raEntry, replies);
    session.openness = openness;
    // Resolved only when both residents accepted a plan with specifics and their openness was earned (see resolutionState).
    const state = resolutionState(session.turnHistory, live.turns.map(t => t.tags), session.openness);
    live.turns[live.turns.length - 1].resolution = state;
    if (state === "resolved" && !session.resolved) {
      session.resolved = true;
      session.resolvedTurn = session.turnCount;
      track("plan_resolved", { turn: session.turnCount });
      DOM.chatLog.appendChild(planNoticeEl());
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
    shownEls.forEach(el => el.remove());
    DOM.raInput.value = text;
    DOM.chatLog.appendChild(sysEl(`Error: ${err.message}. Try again.`));
    track("error_shown", { where: "mediation_turn" });
    setInput(true);
    console.error(err);
  }
}

/* ============================================================
   SAVING LIVE SESSIONS (local server only, never in mock or demo mode)
   ============================================================ */

// Same style as track(): any failure is swallowed so a save can never break the app.
function liveRecord(results, partial) {
  let combined = null, result = null;
  if (results.some(r => r.ok)) {
    combined = combineGraders(results);
    result = scoreFromCombined(combined);
  }
  return buildLiveRecord({
    session, live, graders: results, combined, result, partial, rubricVersion: RUBRIC_VERSION,
    models: { resident: RESIDENT_MODEL, tagger: TAGGER_MODEL, router: ROUTER_MODEL, graders: GRADER_MODELS.map(g => g.id) },
  });
}

function saveLive(results) {
  try {
    if (MOCK || live.saved || live.saving || live.turns.length < 2) return;
    live.saving = true;
    const body = JSON.stringify(liveRecord(results, false));
    authFetch("/api/transcript", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true })
      .then(res => { live.saved = res.ok; live.saving = false; if (!res.ok) console.warn("[Save] server refused the transcript:", res.status); })
      .catch(e => { live.saving = false; console.warn("[Save] failed:", e.message); });
  } catch (e) { live.saving = false; /* ignore */ }
}

// Tab closed or navigated away before the debrief finished: send what we have, once.
function saveLiveOnLeave() {
  try {
    if (MOCK || live.saved || live.saving || live.turns.length < 2) return;
    live.saved = true;
    // sendBeacon cannot set an Authorization header, so use fetch with keepalive.
    fetch("/api/transcript", { method: "POST", headers: { "Content-Type": "application/json", ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) }, body: JSON.stringify(liveRecord([], true)), keepalive: true }).catch(() => {});
  } catch (e) { /* ignore */ }
}
window.addEventListener("pagehide", saveLiveOnLeave);

async function end() {
  if (!session.active) return;
  session.active = false;
  setInput(false);
  saveLog();
  track("session_ended", { turns: session.turnCount, reason: isTurnCapReached(session.turnCount, MAX_TURNS) ? "turn_cap" : "ra_ended" });

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
          const raw = await call(g.id, [{ role: "system", content: prompt }], graderOpts(g), "graders");
          console.log(`[Grader ${g.name} FULL RAW]:`, raw);
          const parsed = parseRubricReply(raw);
          if (!parsed.ok) throw new Error("the reply could not be read as 15 yes/no lines");
          const verified = verifyEvidence(parsed.answers, session.turnHistory);
          if (verified.changed.length) console.warn(`[Grader ${g.name}] YES changed to NO: ${verified.changed.map(id => `Q${id} (${verified.reasons[id]})`).join(", ")}`);
          return { name: g.name, model: g.id, ok: true, answers: verified.answers, changed: verified.changed };
        } catch (e) {
          const finish = e.finishReason ?? "none (no reply received)";
          console.error(`[Grader ${g.name} FAILED]: ${e.message} (finish_reason: ${finish})`);
          return { name: g.name, model: g.id, ok: false, answers: {}, error: `${e.message} (finish_reason: ${finish})` };
        }
      })
    );
    renderDebrief(results);
    saveLive(results);
  } catch (err) {
    DOM.consolidated.innerHTML = `<div class="section-block">Error: ${esc(err.message)}</div>`;
    track("error_shown", { where: "debrief" });
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
  let metCount = 0;
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
    metCount = met;
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
  track("debrief_viewed", { met: metCount, graders_ok: valid.length });
  if (valid.length < results.length) track("error_shown", { where: "grader" });
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
    track("hint_clicked");
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

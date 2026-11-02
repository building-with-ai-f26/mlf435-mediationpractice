const API_URL = "/api/chat";

const MAIN_MODEL = "deepseek/deepseek-chat";

const GRADER_MODELS = [
  { id: "deepseek/deepseek-chat",        name: "DeepSeek" },
  { id: "moonshotai/kimi-k3.1-pro",      name: "Kimi" },
  { id: "google/gemini-2.0-flash-001",   name: "Gemini" },
];

const CONSOLIDATOR_MODEL = "deepseek/deepseek-chat";

const DOM = {
  setupSection:     document.getElementById("setup"),
  chatSection:      document.getElementById("chat-section"),
  debriefSection:   document.getElementById("debrief-section"),

  raNameInput:      document.getElementById("ra-name"),
  topicSelect:      document.getElementById("topic-select"),
  difficultySelect: document.getElementById("difficulty"),
  startBtn:         document.getElementById("start-btn"),

  raNameDisplay:    document.getElementById("ra-name-display"),
  topicDisplay:     document.getElementById("topic-display"),
  difficultyDisplay: document.getElementById("difficulty-display"),
  contextCards:     document.getElementById("context-cards"),
  chatLog:          document.getElementById("chat-log"),
  raInput:          document.getElementById("ra-input"),
  sendBtn:          document.getElementById("send-btn"),
  endBtn:           document.getElementById("end-btn"),

  debriefRaName:    document.getElementById("debrief-ra-name"),
  debriefTopic:     document.getElementById("debrief-topic"),
  debriefDifficulty: document.getElementById("debrief-difficulty"),
  individualGraders: document.getElementById("individual-graders"),
  consolidatedDebrief: document.getElementById("consolidated-debrief"),
  restartBtn:       document.getElementById("restart-btn"),
};

let session = {
  raName: "",
  topic: "noise",
  difficulty: "easy",
  messages: [],
  turnHistory: [],
  active: false,
  turnPhase: "setup", // setup -> alex-intro -> jordan-intro -> mediation
};

/* ============================================================
   ROOMMATE PROFILES
   ============================================================ */

function getRoommateProfiles(topic, difficulty) {
  const traits = {
    easy:   { alex: "frustrated but willing to talk", jordan: "defensive but open to compromise" },
    medium: { alex: "frustrated and tired of being ignored", jordan: "defensive and feels singled out" },
    hard:   { alex: "very upset, near their breaking point", jordan: "angry, feels attacked, resistant" },
  };

  const stances = {
    noise: {
      alex: "Jordan plays loud music and has friends over past midnight. Alex cannot sleep and has early classes.",
      jordan: "Alex goes to bed at 9pm and expects total silence. Jordan has evening classes and needs to unwind.",
    },
    cleaning: {
      alex: "Jordan never cleans shared spaces and leaves dishes for days. Alex ends up doing all the work.",
      jordan: "Alex is obsessively clean and rearranges Jordan's things without asking. Jordan feels micromanaged.",
    },
    "guest policy": {
      alex: "Jordan's partner sleeps over four nights a week. Alex never agreed to a third roommate.",
      jordan: "Alex is never around anyway and complains about a guest they barely see. Jordan pays rent too.",
    },
    hygiene: {
      alex: "Jordan's laundry piles up for weeks and the room smells. Alex is embarrassed to have anyone over.",
      jordan: "Alex uses scented products that give Jordan headaches but refuses to stop. Jordan is the one suffering.",
    },
    "shared items": {
      alex: "Jordan borrows Alex's food, charger, and clothes without asking and never replaces anything.",
      jordan: "Alex labels everything and treats the room like a store. Jordan thought sharing was part of living together.",
    },
  };

  const t = traits[difficulty] || traits.medium;
  const s = stances[topic] || stances.noise;

  return {
    alex: {
      name: "Alex",
      age: "20",
      major: "Biology",
      year: "Junior",
      personality: "Structured, early riser, values quiet and order.",
      mood: t.alex,
      stance: s.alex,
    },
    jordan: {
      name: "Jordan",
      age: "19",
      major: "Communications",
      year: "Sophomore",
      personality: "Social, flexible schedule, values freedom and spontaneity.",
      mood: t.jordan,
      stance: s.jordan,
    },
  };
}

function renderContextCards(profiles) {
  DOM.contextCards.innerHTML = `
    <div class="roommate-card alex">
      <div class="card-name">${profiles.alex.name}</div>
      <div class="card-role">Roommate A</div>
      <div class="card-detail"><strong>Age:</strong> ${profiles.alex.age} · <strong>Year:</strong> ${profiles.alex.year} · <strong>Major:</strong> ${profiles.alex.major}</div>
      <div class="card-detail"><strong>Personality:</strong> ${profiles.alex.personality}</div>
      <div class="card-detail"><strong>Current Mood:</strong> ${profiles.alex.mood}</div>
      <div class="card-stance"><strong>Position:</strong> ${profiles.alex.stance}</div>
    </div>
    <div class="roommate-card jordan">
      <div class="card-name">${profiles.jordan.name}</div>
      <div class="card-role">Roommate B</div>
      <div class="card-detail"><strong>Age:</strong> ${profiles.jordan.age} · <strong>Year:</strong> ${profiles.jordan.year} · <strong>Major:</strong> ${profiles.jordan.major}</div>
      <div class="card-detail"><strong>Personality:</strong> ${profiles.jordan.personality}</div>
      <div class="card-detail"><strong>Current Mood:</strong> ${profiles.jordan.mood}</div>
      <div class="card-stance"><strong>Position:</strong> ${profiles.jordan.stance}</div>
    </div>
  `;
}

/* ============================================================
   PROMPTS
   ============================================================ */

function buildAlexIntroPrompt(topic, difficulty, profile) {
  const d = difficulty === "easy" ? "cooperative" : difficulty === "hard" ? "very upset and emotional" : "frustrated and defensive";
  return `You are Alex, a roommate in a realistic conflict roleplay for RA training.

YOUR PROFILE:
- Name: Alex
- Age: ${profile.alex.age}, ${profile.alex.year}, ${profile.alex.major}
- Personality: ${profile.alex.personality}
- Current mood: ${profile.alex.mood}
- Your position: ${profile.alex.stance}

The difficulty is "${difficulty}". You are ${d}.

This is the FIRST message. You are speaking directly to the RA. Introduce yourself briefly (name, year, major in one sentence), then explain the ${topic} problem from your perspective in 2-3 sentences. Be emotional but not irrational. End with a question or a request for help.

Format: Start with "**Alex:**" then your response. Do NOT mention Jordan yet.`;
}

function buildJordanIntroPrompt(topic, difficulty, profile, alexMsg) {
  const d = difficulty === "easy" ? "cooperative" : difficulty === "hard" ? "very upset and emotional" : "frustrated and defensive";
  return `You are Jordan, a roommate in a realistic conflict roleplay for RA training.

YOUR PROFILE:
- Name: Jordan
- Age: ${profile.jordan.age}, ${profile.jordan.year}, ${profile.jordan.major}
- Personality: ${profile.jordan.personality}
- Current mood: ${profile.jordan.mood}
- Your position: ${profile.jordan.stance}

The difficulty is "${difficulty}". You are ${d}.

Alex just said to the RA: "${alexMsg}"

This is the SECOND message. The RA has acknowledged Alex and is now asking for your side. Introduce yourself briefly (name, year, major in one sentence), then explain YOUR perspective on the ${topic} issue in 2-3 sentences. Push back on Alex's version without being hostile. End with how you feel about the situation.

Format: Start with "**Jordan:**" then your response.`;
}

function buildMediationPrompt(topic, difficulty, history) {
  const d = difficulty === "easy" ? "cooperative, willing to listen" : difficulty === "hard" ? "very upset, resistant, emotional" : "frustrated, needs validation before compromising";
  const lastSpeaker = history.length > 0 ? history[history.length - 1].sender : "Jordan";
  const nextSpeaker = lastSpeaker === "Alex" ? "Jordan" : "Alex";

  const transcript = history.map(h => `${h.sender}: ${h.text}`).join("\n");

  return `You are ${nextSpeaker}, a roommate in a realistic conflict roleplay for RA training.

TOPIC: ${topic}
DIFFICULTY: ${difficulty} (you are ${d})

CONVERSATION SO FAR:
${transcript}

The RA just spoke. Respond as ${nextSpeaker} in 2-4 sentences.
Rules:
- Address the RA directly
- Stay in character
- If the RA was helpful, soften slightly but do not magically agree
- If the RA was unhelpful, push back or shut down slightly
- Do NOT resolve the conflict yourself

Format: Start with "**${nextSpeaker}:**" then your response.`;
}

function buildGraderPrompt(modelName, topic, difficulty, history) {
  const transcript = history.map(h => `${h.sender}: ${h.text}`).join("\n");
  return `You are an experienced RA supervisor grading a practice mediation.

SESSION:
- Topic: ${topic}
- Difficulty: ${difficulty}
- Grader: ${modelName}

TRANSCRIPT:
${transcript}

Grade the RA's performance on a scale of 1 to 100.

Respond in this exact format:
SCORE: [number]/100
STRENGTHS:
- [bullet 1]
- [bullet 2]
GAPS:
- [bullet 1]
- [bullet 2]

Be concise. No em dashes. Use plain language.`;
}

function buildConsolidatorPrompt(gradings, history) {
  const g = gradings.map((g, i) => `GRADER ${i + 1} (${g.model}): Score ${g.score}/100\nStrengths:\n${g.strengths.map(s => "- " + s).join("\n")}\nGaps:\n${g.gaps.map(gap => "- " + gap).join("\n")}`).join("\n\n---\n\n");

  return `You are a senior RA training coordinator. Three different AI supervisors graded the same practice mediation. Consolidate their feedback into one clear, actionable debrief.

${g}

Provide the final output in this exact format:

OVERALL SCORE: [average of the three scores, rounded to nearest whole number]/100

WHAT THE RA DID WELL:
- [specific strength, with action detail]
- [specific strength, with action detail]
- [specific strength, with action detail]

WHAT THE RA MISSED:
- [specific gap, with what to do instead]
- [specific gap, with what to do instead]
- [specific gap, with what to do instead]

ONE THING TO TRY NEXT TIME:
[One concrete, specific technique the RA should practice]

Rules:
- No em dashes anywhere
- Be concise and action-oriented
- Reference specific moments from the conversation
- Do not repeat the same point multiple times`;
}

/* ============================================================
   UI HELPERS
   ============================================================ */

function addMessage(sender, text, type) {
  const div = document.createElement("div");
  div.className = `message ${type}`;
  const senderSpan = document.createElement("span");
  senderSpan.className = "sender";
  senderSpan.textContent = sender;
  div.appendChild(senderSpan);
  div.appendChild(document.createTextNode(text));
  DOM.chatLog.appendChild(div);
  DOM.chatLog.scrollTop = DOM.chatLog.scrollHeight;
}

function addSystem(text) {
  const div = document.createElement("div");
  div.className = "message system";
  div.textContent = text;
  DOM.chatLog.appendChild(div);
  DOM.chatLog.scrollTop = DOM.chatLog.scrollHeight;
}

function showLoading(text = "Thinking...") {
  const div = document.createElement("div");
  div.className = "message system loading";
  div.id = "loading-msg";
  div.textContent = text;
  DOM.chatLog.appendChild(div);
  DOM.chatLog.scrollTop = DOM.chatLog.scrollHeight;
}

function hideLoading() {
  const el = document.getElementById("loading-msg");
  if (el) el.remove();
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

async function callModel(model, messages) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, temperature: 0.8, max_tokens: 300 }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error?.message || "API error");
  const msg = data.choices[0].message;
  return (msg.content || msg.reasoning || "").trim();
}

function parseNamedMessage(raw) {
  const m = raw.match(/^\*\*?(\w+)\*\*?[\s:]+(.+)$/s);
  if (m) return { name: m[1], text: m[2].trim() };
  return { name: "Roommate", text: raw };
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
  session.turnPhase = "alex-intro";

  DOM.raNameDisplay.textContent = session.raName;
  DOM.topicDisplay.textContent = session.topic;
  DOM.difficultyDisplay.textContent = session.difficulty;

  DOM.setupSection.classList.add("hidden");
  DOM.chatSection.classList.remove("hidden");
  DOM.debriefSection.classList.add("hidden");
  DOM.chatLog.innerHTML = "";
  DOM.individualGraders.innerHTML = "";
  DOM.consolidatedDebrief.innerHTML = "";

  const profiles = getRoommateProfiles(session.topic, session.difficulty);
  renderContextCards(profiles);

  addSystem("Session starting. Meet your residents...");
  setInput(false);

  try {
    // Alex introduces himself
    showLoading("Alex is introducing himself...");
    const alexPrompt = buildAlexIntroPrompt(session.topic, session.difficulty, profiles);
    const alexRaw = await callModel(MAIN_MODEL, [{ role: "system", content: alexPrompt }]);
    hideLoading();

    const alexParsed = parseNamedMessage(alexRaw);
    addMessage("Alex", alexParsed.text, "alex");
    session.turnHistory.push({ sender: "Alex", text: alexParsed.text });

    // Jordan introduces himself
    showLoading("Jordan is sharing their side...");
    const jordanPrompt = buildJordanIntroPrompt(session.topic, session.difficulty, profiles, alexParsed.text);
    const jordanRaw = await callModel(MAIN_MODEL, [{ role: "system", content: jordanPrompt }]);
    hideLoading();

    const jordanParsed = parseNamedMessage(jordanRaw);
    addMessage("Jordan", jordanParsed.text, "jordan");
    session.turnHistory.push({ sender: "Jordan", text: jordanParsed.text });

    session.turnPhase = "mediation";
    addSystem("The RA (you) may now begin mediating.");
    setInput(true);
  } catch (err) {
    hideLoading();
    addSystem(`Error: ${err.message}. Please refresh and try again.`);
    console.error(err);
  }
}

async function sendRAMessage() {
  const text = DOM.raInput.value.trim();
  if (!text || !session.active) return;

  addMessage(session.raName, text, "ra");
  session.turnHistory.push({ sender: session.raName, text });
  DOM.raInput.value = "";
  setInput(false);

  showLoading(`${session.turnHistory[session.turnHistory.length - 2]?.sender === "Alex" ? "Jordan" : "Alex"} is responding...`);

  try {
    const prompt = buildMediationPrompt(session.topic, session.difficulty, session.turnHistory);
    const raw = await callModel(MAIN_MODEL, [{ role: "system", content: prompt }]);
    hideLoading();

    const parsed = parseNamedMessage(raw);
    const type = parsed.name.toLowerCase().includes("alex") ? "alex" : parsed.name.toLowerCase().includes("jordan") ? "jordan" : "roommate";
    addMessage(parsed.name, parsed.text, type);
    session.turnHistory.push({ sender: parsed.name, text: parsed.text });
    setInput(true);
  } catch (err) {
    hideLoading();
    addSystem(`Error: ${err.message}. Please try again.`);
    setInput(true);
    console.error(err);
  }
}

/* ============================================================
   DEBRIEF WITH 3 GRADERS
   ============================================================ */

async function endSession() {
  if (!session.active) return;
  session.active = false;
  setInput(false);

  addSystem("Session ended. Sending to 3 AI graders...");

  DOM.chatSection.classList.add("hidden");
  DOM.debriefSection.classList.remove("hidden");
  DOM.debriefRaName.textContent = session.raName;
  DOM.debriefTopic.textContent = session.topic;
  DOM.debriefDifficulty.textContent = session.difficulty;
  DOM.consolidatedDebrief.innerHTML = '<div class="loading">Grading in progress... This may take 10-20 seconds.</div>';

  try {
    // Run 3 graders in parallel
    const graderPromises = GRADER_MODELS.map(async (g) => {
      const prompt = buildGraderPrompt(g.name, session.topic, session.difficulty, session.turnHistory);
      try {
        const raw = await callModel(g.id, [{ role: "system", content: prompt }]);
        return parseGrading(raw, g.name);
      } catch (err) {
        console.error(`Grader ${g.name} failed:`, err);
        return { model: g.name, score: 0, strengths: ["Grading failed"], gaps: [err.message] };
      }
    });

    const gradings = await Promise.all(graderPromises);

    // Render individual grader cards
    renderGraderCards(gradings);

    // Consolidate
    DOM.consolidatedDebrief.innerHTML = '<div class="loading">Consolidating feedback...</div>';
    const consolidatePrompt = buildConsolidatorPrompt(gradings, session.turnHistory);
    const consolidatedRaw = await callModel(CONSOLIDATOR_MODEL, [{ role: "system", content: consolidatePrompt }]);
    renderConsolidated(consolidatedRaw);
  } catch (err) {
    DOM.consolidatedDebrief.innerHTML = `<div class="loading">Error: ${err.message}</div>`;
    console.error(err);
  }
}

function parseGrading(raw, modelName) {
  const scoreMatch = raw.match(/SCORE:\s*(\d+)/i);
  const score = scoreMatch ? parseInt(scoreMatch[1]) : 0;

  const strengths = [];
  const gaps = [];

  const lines = raw.split("\n");
  let section = null;
  for (const line of lines) {
    const t = line.trim();
    if (/^STRENGTHS:/i.test(t)) { section = "strengths"; continue; }
    if (/^GAPS:/i.test(t)) { section = "gaps"; continue; }
    if (/^SCORE:/i.test(t)) continue;
    if (t.startsWith("- ") && section) {
      section === "strengths" ? strengths.push(t.slice(2)) : gaps.push(t.slice(2));
    }
  }

  return { model: modelName, score, strengths: strengths.length ? strengths : ["No specific strengths noted"], gaps: gaps.length ? gaps : ["No specific gaps noted"] };
}

function renderGraderCards(gradings) {
  DOM.individualGraders.innerHTML = gradings.map(g => `
    <div class="grader-card">
      <h4>${g.model} Grader</h4>
      <div class="grader-score">${g.score}</div>
      <div class="grader-model">out of 100</div>
      <p style="font-weight:600;font-size:13px;margin:8px 0 4px;">Strengths</p>
      <ul>${g.strengths.map(s => `<li>${escapeHtml(s)}</li>`).join("")}</ul>
      <p style="font-weight:600;font-size:13px;margin:8px 0 4px;">Gaps</p>
      <ul>${g.gaps.map(gap => `<li>${escapeHtml(gap)}</li>`).join("")}</ul>
    </div>
  `).join("");
}

function renderConsolidated(raw) {
  // Parse sections
  const sections = [];
  const lines = raw.split("\n");
  let current = null;

  for (let line of lines) {
    const t = line.trim();
    if (!t) continue;

    if (/^OVERALL SCORE:/i.test(t)) {
      const m = t.match(/(\d+)/);
      sections.push({ type: "score", value: m ? m[1] : "N/A" });
      continue;
    }
    if (/^WHAT THE RA DID WELL:/i.test(t)) {
      current = { type: "strengths", items: [], title: "What You Did Well" };
      sections.push(current);
      continue;
    }
    if (/^WHAT THE RA MISSED:/i.test(t)) {
      current = { type: "gaps", items: [], title: "What You Missed" };
      sections.push(current);
      continue;
    }
    if (/^ONE THING TO TRY NEXT TIME:/i.test(t)) {
      current = { type: "next", items: [], title: "One Thing to Try Next Time" };
      sections.push(current);
      continue;
    }
    if (t.startsWith("- ") && current) {
      current.items.push(t.slice(2));
    } else if (current && current.type === "next" && current.items.length === 0) {
      current.items.push(t);
    } else if (current) {
      current.items[current.items.length - 1] += " " + t;
    }
  }

  let html = "";
  for (const s of sections) {
    if (s.type === "score") {
      html += `<div class="overall-score">${s.value}/100</div><div class="score-label">Overall Score</div>`;
    } else if (s.type === "next") {
      html += `<div class="debrief-section"><h4>${s.title}</h4><p>${escapeHtml(s.items.join(" "))}</p></div>`;
    } else {
      html += `<div class="debrief-section"><h4>${s.title}</h4><ul>${s.items.map(i => `<li>${escapeHtml(i)}</li>`).join("")}</ul></div>`;
    }
  }

  DOM.consolidatedDebrief.innerHTML = html || `<div class="debrief-section">${escapeHtml(raw).replace(/\n/g, "<br>")}</div>`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/* ============================================================
   EVENTS
   ============================================================ */

DOM.startBtn.addEventListener("click", startSession);
DOM.sendBtn.addEventListener("click", sendRAMessage);
DOM.endBtn.addEventListener("click", endSession);
DOM.restartBtn.addEventListener("click", () => {
  DOM.setupSection.classList.remove("hidden");
  DOM.chatSection.classList.add("hidden");
  DOM.debriefSection.classList.add("hidden");
  DOM.chatLog.innerHTML = "";
  DOM.contextCards.innerHTML = "";
  DOM.raInput.value = "";
});

DOM.raInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendRAMessage();
  }
});

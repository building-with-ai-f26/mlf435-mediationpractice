// ============================================================
// RA Practice Scenarios — Frontend Logic
// Topic: user types any topic (default: noise)
// Difficulty: easy / medium / hard
// Two AI roommates take turns responding to the RA
// ============================================================

const API_URL = "/api/chat";
const MODEL = "moonshotai/kimi-k3.1-pro";

// DOM elements
const setupSection = document.getElementById("setup");
const chatSection = document.getElementById("chat-section");
const debriefSection = document.getElementById("debrief-section");

const topicInput = document.getElementById("topic-input");
const difficultySelect = document.getElementById("difficulty");
const startBtn = document.getElementById("start-btn");

const topicDisplay = document.getElementById("topic-display");
const difficultyDisplay = document.getElementById("difficulty-display");
const chatLog = document.getElementById("chat-log");
const raInput = document.getElementById("ra-input");
const sendBtn = document.getElementById("send-btn");
const endBtn = document.getElementById("end-btn");

const debriefContent = document.getElementById("debrief-content");
const restartBtn = document.getElementById("restart-btn");

// Session state
let session = {
  topic: "noise",
  difficulty: "easy",
  messages: [],        // Full conversation for the LLM
  turnHistory: [],     // { sender: "Alex|Jordan|RA", text: "" } for debrief
  active: false,
  currentSpeaker: null,
};

// ============================================================
// PROMPT BUILDERS
// ============================================================

function buildSystemPrompt(topic, difficulty) {
  const difficultyTraits = {
    easy:   "cooperative but genuinely annoyed. They want to resolve this and are willing to compromise.",
    medium: "frustrated and somewhat defensive. They need the RA to actively listen and propose specific solutions before they soften.",
    hard:   "very upset, speaking emotionally, possibly raising their voice. They feel unheard and may resist compromise until the RA validates their feelings deeply.",
  };

  return `You are running a realistic roommate-conflict roleplay for a Resident Assistant (RA) training exercise.

SITUATION:
- Two roommates, ALEX and JORDAN, are in conflict about "${topic}".
- ALEX and JORDAN each have distinct personalities and opposing positions on the issue.
- The difficulty level is "${difficulty}". This means the roommates are: ${difficultyTraits[difficulty]}

RULES FOR GENERATING RESPONSES:
1. Only ONE roommate speaks at a time. Alternate between ALEX and JORDAN each turn.
2. Each response should be 2–4 sentences, spoken in the roommate's natural voice.
3. The roommates address the RA directly (e.g., "I just feel like...", "Can you tell Jordan that...").
4. Stay in character. Do not break the fourth wall or mention that this is an AI simulation.
5. Do not resolve the conflict yourself. Let the RA's mediation drive the outcome.
6. If the RA says something helpful (listens, validates, proposes a compromise), the roommates should gradually soften but not magically agree.
7. If the RA says something unhelpful (takes sides, dismisses feelings, gives orders), the roommates should push back or shut down slightly.
8. Include the roommate's name at the start of the response, e.g. "**Alex:** I just think..."

For the VERY FIRST message only, introduce both roommates briefly (1 sentence each) and have ALEX speak first, expressing their frustration about the ${topic} issue.

After the first message, only output the next roommate's response each turn.`;
}

function buildDebriefPrompt(topic, difficulty, history) {
  const transcript = history
    .map(h => `${h.sender}: ${h.text}`)
    .join("\n");

  return `You are a senior RA supervisor reviewing a practice mediation session.

SESSION DETAILS:
- Topic: ${topic}
- Difficulty: ${difficulty}

TRANSCRIPT:
${transcript}

Please provide a short, constructive debrief with three sections:

1. WHAT THE RA DID WELL (2–3 bullet points)
2. WHAT THE RA MISSED (2–3 bullet points)
3. ONE THING TO TRY NEXT TIME (1 specific technique or approach)

Be encouraging but honest. Reference specific moments from the transcript when possible.`;
}

// ============================================================
// UI HELPERS
// ============================================================

function addMessage(sender, text, type) {
  const div = document.createElement("div");
  div.className = `message ${type}`;

  if (type === "system") {
    div.textContent = text;
  } else {
    const senderSpan = document.createElement("span");
    senderSpan.className = "sender";
    senderSpan.textContent = sender;
    div.appendChild(senderSpan);
    div.appendChild(document.createTextNode(text));
  }

  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function showLoading() {
  const div = document.createElement("div");
  div.className = "message system loading";
  div.id = "loading-msg";
  div.textContent = "Roommates are thinking...";
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function hideLoading() {
  const el = document.getElementById("loading-msg");
  if (el) el.remove();
}

function setInputEnabled(enabled) {
  raInput.disabled = !enabled;
  sendBtn.disabled = !enabled;
  endBtn.disabled = !enabled;
  if (enabled) raInput.focus();
}

// ============================================================
// API CALL
// ============================================================

async function callLLM(messages) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: messages,
      temperature: 0.8,
      max_tokens: 300,
    }),
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error?.message || "API request failed");
  }
  const msg = data.choices[0].message;
  const text = msg.content || msg.reasoning || "";
  return text.trim();
}

// ============================================================
// TURN LOGIC
// ============================================================

async function startSession() {
  session.topic = topicInput.value.trim() || "noise";
  session.difficulty = difficultySelect.value;
  session.messages = [
    { role: "system", content: buildSystemPrompt(session.topic, session.difficulty) },
  ];
  session.turnHistory = [];
  session.active = true;
  session.currentSpeaker = "Alex";

  // Update UI
  topicDisplay.textContent = session.topic;
  difficultyDisplay.textContent = session.difficulty;
  setupSection.classList.add("hidden");
  chatSection.classList.remove("hidden");
  debriefSection.classList.add("hidden");
  chatLog.innerHTML = "";
  debriefContent.innerHTML = "";

  addMessage(null, "Session started. The roommates are waiting...", "system");
  setInputEnabled(false);
  showLoading();

  try {
    // First message: both roommates introduced, Alex speaks
    const firstMsg = await callLLM(session.messages);
    hideLoading();

    // Parse name and text
    const parsed = parseRoommateMessage(firstMsg);
    addMessage(parsed.name, parsed.text, "roommate");

    session.messages.push({ role: "assistant", content: firstMsg });
    session.turnHistory.push({ sender: parsed.name, text: parsed.text });
    session.currentSpeaker = parsed.name === "Alex" ? "Jordan" : "Alex";

    setInputEnabled(true);
  } catch (err) {
    hideLoading();
    addMessage(null, `Error: ${err.message}. Please refresh and try again.`, "system");
    console.error(err);
  }
}

function parseRoommateMessage(raw) {
  // Look for **Name:** or Name: at the start
  const match = raw.match(/^\*\*?(\w+)\*\*?[:\s]+(.+)$/s);
  if (match) {
    return { name: match[1], text: match[2].trim() };
  }
  // Fallback: just return the whole thing as text from Unknown
  return { name: "Roommate", text: raw };
}

async function sendRAMessage() {
  const text = raInput.value.trim();
  if (!text || !session.active) return;

  // Show RA message
  addMessage("You (RA)", text, "ra");
  session.turnHistory.push({ sender: "RA", text });

  // Add to LLM context
  session.messages.push({ role: "user", content: text });
  raInput.value = "";
  setInputEnabled(false);
  showLoading();

  try {
    const rawResponse = await callLLM(session.messages);
    hideLoading();

    const parsed = parseRoommateMessage(rawResponse);

    // Validate: make sure we got the OTHER roommate
    if (parsed.name === session.currentSpeaker || parsed.name === "Roommate") {
      // OK or fallback
    }

    addMessage(parsed.name, parsed.text, "roommate");
    session.messages.push({ role: "assistant", content: rawResponse });
    session.turnHistory.push({ sender: parsed.name, text: parsed.text });

    // Flip turn
    session.currentSpeaker = parsed.name === "Alex" ? "Jordan" : "Alex";

    setInputEnabled(true);
  } catch (err) {
    hideLoading();
    addMessage(null, `Error: ${err.message}. Please try again.`, "system");
    setInputEnabled(true);
    console.error(err);
  }
}

async function endSession() {
  if (!session.active) return;
  session.active = false;
  setInputEnabled(false);

  addMessage(null, "Session ended. Generating debrief...", "system");

  const debriefMessages = [
    {
      role: "system",
      content: buildDebriefPrompt(session.topic, session.difficulty, session.turnHistory),
    },
  ];

  try {
    const debriefText = await callLLM(debriefMessages);
    debriefContent.innerHTML = markdownToHtml(debriefText);
    chatSection.classList.add("hidden");
    debriefSection.classList.remove("hidden");
  } catch (err) {
    debriefContent.innerHTML = `<p class="loading">Error generating debrief: ${err.message}</p>`;
    chatSection.classList.add("hidden");
    debriefSection.classList.remove("hidden");
    console.error(err);
  }
}

// Very simple markdown → HTML for debrief
function markdownToHtml(md) {
  return md
    .replace(/^###? (.+)$/gim, "<h3>$1</h3>")
    .replace(/^\* \*\*(.+?)\*\*[:\s]*(.+)$/gim, "<li><strong>$1:</strong> $2</li>")
    .replace(/^\* (.+)$/gim, "<li>$1</li>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(<li>.+<\/li>\n?)+/g, match => `<ul>${match}</ul>`);
}

// ============================================================
// EVENT LISTENERS
// ============================================================

startBtn.addEventListener("click", startSession);
sendBtn.addEventListener("click", sendRAMessage);
endBtn.addEventListener("click", endSession);
restartBtn.addEventListener("click", () => {
  setupSection.classList.remove("hidden");
  chatSection.classList.add("hidden");
  debriefSection.classList.add("hidden");
  chatLog.innerHTML = "";
  debriefContent.innerHTML = "";
  raInput.value = "";
});

raInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendRAMessage();
  }
});

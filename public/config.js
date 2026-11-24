import { startingOpenness } from "./logic.js";

// Settings, resident profiles, resident prompts and session shape. No DOM, no network, no storage,
// so app.js, mock.js, tests and Node scripts can all import this file.

// Every model id lives here. Node (server, tools) reads each from the environment; the defaults are below.
// The browser has no environment, so it asks the server (/config.json) and calls applyServerModels().
// The server builds its allowlist from these same values (allModelIds), so changing one here or in the env is enough.
// Env names: RESIDENT_MODEL, GRADER_1_MODEL, GRADER_2_MODEL, GRADER_3_MODEL, TAGGER_MODEL, ROUTER_MODEL.
export const DEFAULT_RESIDENT_MODEL = "anthropic/claude-haiku-5.5";
export const DEFAULT_GRADER_MODELS = ["anthropic/claude-haiku-5.5", "google/gemini-3.1-flash-lite", "openai/gpt-6-luna"];
export const DEFAULT_TAGGER_MODEL = "anthropic/claude-haiku-5.5";
export const DEFAULT_ROUTER_MODEL = "anthropic/claude-haiku-5.5";
export function resolveModelId(value, fallback) {
  const v = String(value ?? "").trim();
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.:-]+$/.test(v) ? v : fallback;
}
export const resolveResidentModel = value => resolveModelId(value, DEFAULT_RESIDENT_MODEL);
const env = name => (typeof process !== "undefined" ? process.env?.[name] : undefined);

export let RESIDENT_MODEL = resolveResidentModel(env("RESIDENT_MODEL"));
export function setResidentModel(value) { RESIDENT_MODEL = resolveResidentModel(value); }
// One reasoning setting for residents, router, tagger and graders: off. A reasoning model (Haiku) otherwise spends the
// whole token budget thinking and returns nothing. A model that cannot turn it off (Gemini 3.6 Flash) uses the lowest setting.
export const REASONING = { enabled: false };
export const REASONING_LOWEST = { effort: "low" };
// Three graders from three vendors. All turn reasoning off. Gemini 3.6 Flash could not (mandatory reasoning used up the token budget and
// grading failed in about 3 of 4 sessions), so slot 2 is Gemini 3.1 Flash Lite. A grader entry may carry its own `reasoning` (see graderOpts).
export const GRADER_MODELS = [
  { id: resolveModelId(env("GRADER_1_MODEL"), DEFAULT_GRADER_MODELS[0]), name: "Claude" },
  { id: resolveModelId(env("GRADER_2_MODEL"), DEFAULT_GRADER_MODELS[1]), name: "Gemini" },
  { id: resolveModelId(env("GRADER_3_MODEL"), DEFAULT_GRADER_MODELS[2]), name: "GPT" },
];
export let TAGGER_MODEL = resolveModelId(env("TAGGER_MODEL"), DEFAULT_TAGGER_MODEL);
export let ROUTER_MODEL = resolveModelId(env("ROUTER_MODEL"), DEFAULT_ROUTER_MODEL);

// Browser: take the ids the server is using (from /config.json). Anything missing or malformed keeps the current value.
export function applyServerModels(c) {
  if (!c || typeof c !== "object") return;
  if (c.residentModel) setResidentModel(c.residentModel);
  if (Array.isArray(c.graderModels)) c.graderModels.slice(0, GRADER_MODELS.length).forEach((id, i) => { GRADER_MODELS[i].id = resolveModelId(id, GRADER_MODELS[i].id); });
  if (c.taggerModel) TAGGER_MODEL = resolveModelId(c.taggerModel, TAGGER_MODEL);
  if (c.routerModel) ROUTER_MODEL = resolveModelId(c.routerModel, ROUTER_MODEL);
}
// Every model id the app may call. The server allows exactly these.
export const allModelIds = () => [...new Set([RESIDENT_MODEL, ...GRADER_MODELS.map(g => g.id), TAGGER_MODEL, ROUTER_MODEL])];
// The shape of /config.json's model fields. Used by server.mjs.
export const modelConfig = () => ({ residentModel: RESIDENT_MODEL, graderModels: GRADER_MODELS.map(g => g.id), taggerModel: TAGGER_MODEL, routerModel: ROUTER_MODEL });

export const TOKENS_RESIDENT = 150;
export const RESIDENT_OPTS = { maxTokens: TOKENS_RESIDENT, reasoning: REASONING };
// 2000 since 2026-11-23: the rule is "1500 unless any call was cut off or the 95th percentile is above 1100". A current grader (GPT-6 Luna) was
// cut off once in 187 calls. 2000 is also the server's cap (MAX_TOKENS_CAP in chatBody.mjs). Numbers: docs/model-choice.md.
export const TOKENS_GRADER = 2000;
// Graders: deterministic, and no hidden reasoning (Haiku spent its whole 600 token budget on it in tools/probe-models.mjs).
export const GRADER_OPTS = { maxTokens: TOKENS_GRADER, temperature: 0, reasoning: REASONING };
// Options for one grader: the shared ones, with the grader's own reasoning setting when it has one.
export const graderOpts = g => (g.reasoning ? { ...GRADER_OPTS, reasoning: g.reasoning } : GRADER_OPTS);
// Tagger: labels each RA message so resident openness can change. Same settings as the graders, small budget.
export const TOKENS_TAGGER = 220; // was 150: the tagger now also returns proposal_on_table, meets_needs and plan_has_specifics
export const TAGGER_OPTS = { maxTokens: TOKENS_TAGGER, temperature: 0, reasoning: REASONING };
// Router: picks who answers when the RA message names nobody. One word back, so 30 tokens is plenty.
export const TOKENS_ROUTER = 30;
export const ROUTER_OPTS = { maxTokens: TOKENS_ROUTER, temperature: 0, reasoning: REASONING };
export const MAX_TURNS = 15;

// Practice mode: "text" is the default and behaves as before. "voice" reads resident replies aloud.
// The mode never changes what is stored, graded or sent to the models.
export const PRACTICE_MODES = ["text", "voice"];
export const DEFAULT_PRACTICE_MODE = "text";
// Read-aloud. One voice per resident. The server maps the resident to the id, so the browser never sends a voice id.
// These ids are placeholders until a real TTS provider is chosen (see tts.mjs).
export const VOICE_IDS = { alex: "voice-alex", jordan: "voice-jordan" };
export const MAX_TTS_CHARS = 600;
// Push-to-talk. The server enforces the size cap and the declared length; the browser stops recording at the limit.
export const MAX_STT_SECONDS = 30;
export const MAX_STT_BYTES = 512 * 1024;
export const STT_MIME_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav"];

// What each resident needs for any deal to work (mustHaves, 2) and where they can give (flexible, 2).
// Plain data, one entry per topic, so it can move into a scenario file later without changing shape.
// Every topic has at least one deal that keeps all four must-haves, so a good RA can get to a plan.
export const NEEDS = {
  noise: {
    alex:   { mustHaves: ["Lights out and the room quiet by 10:30pm on weeknights, because of a 7am lab.", "No loud noise or music in the room before 7am."],
              flexible: ["Weekends can run later.", "Jordan may use headphones or the lounge for loud activities."] },
    jordan: { mustHaves: ["The study group keeps meeting until 11:30pm on Tuesdays and Thursdays.", "Jordan can talk and move around normally in the room until 10:30pm."],
              flexible: ["Where the study group meets (the room, the lounge or the library).", "Other nights can wind down earlier."] },
  },
  cleaning: {
    alex:   { mustHaves: ["The kitchen and bathroom are cleaned on a fixed weekly schedule that is written down.", "Dishes are not left in the sink overnight."],
              flexible: ["Which weekday the deep clean happens.", "The two of them can swap chores some weeks."] },
    jordan: { mustHaves: ["Jordan's belongings are not moved or rearranged without asking first.", "The cleaning standard is realistic for a student with a heavy week."],
              flexible: ["Who takes which chore.", "Cleaning can be split into shorter sessions."] },
  },
  "guest policy": {
    alex:   { mustHaves: ["No overnight guests on weeknights, because of early classes.", "Alex gets advance notice before any overnight guest."],
              flexible: ["How many weekend nights a guest can stay.", "The notice can be a text message."] },
    jordan: { mustHaves: ["Jordan's partner can still visit and stay over on weekends.", "Jordan does not have to ask permission for daytime visits."],
              flexible: ["Which weekend nights.", "Where Alex stays when a guest is over, if Alex chooses."] },
  },
  hygiene: {
    alex:   { mustHaves: ["Dirty laundry is kept in a closed hamper and washed at least every two weeks.", "The smell problem is fixed before Alex has visitors."],
              flexible: ["Which laundry day.", "Using the room's air purifier or an open window."] },
    jordan: { mustHaves: ["No heavily scented products used in the room, because they cause headaches.", "Jordan is asked politely, not blamed."],
              flexible: ["Unscented alternatives Alex picks.", "Alex can use scented products outside the room."] },
  },
  "shared items": {
    alex:   { mustHaves: ["Alex's food and chargers are not taken without asking first.", "Anything used up is replaced within a week."],
              flexible: ["A shared shelf for common items.", "Which items count as shared."] },
    jordan: { mustHaves: ["There is a clear list of what is shared and what is private.", "Jordan can still borrow small things in an emergency."],
              flexible: ["How the labels are done.", "How the two split the cost of shared supplies."] },
  },
  "religious practice": {
    alex:   { mustHaves: ["Alex can pray quietly in the room each night without being interrupted.", "Alex's food stays separate from pork, in line with a halal diet."],
              flexible: ["The exact prayer time can be shared with Jordan ahead of time.", "Which fridge shelf is used."] },
    jordan: { mustHaves: ["Jordan can keep eating normal foods, including bacon, at home.", "Jordan does not have to explain or justify food choices."],
              flexible: ["Storing the bacon in a sealed container on its own shelf.", "Cleaning the pans right after cooking."] },
  },
};

export function getNeeds(topic) {
  return NEEDS[topic] || NEEDS.noise;
}

export function getProfiles(topic, difficulty) {
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
    "religious practice": {
      alex: "Alex is Muslim and prays quietly each night after Jordan goes to sleep. Jordan openly keeps bacon in the shared fridge, and Alex follows a halal diet. They have lived together a few weeks and things were mostly fine. Alex is hesitant to raise it because Alex does not want tension, and only opens up when the RA gives Alex space to share. Alex speaks respectfully at all times.",
      jordan: "Jordan openly keeps bacon in the shared fridge. Jordan and Alex have lived together a few weeks and things were mostly fine. Jordan speaks respectfully at all times, whatever the mood, and is willing to listen to Alex.",
    },
  };
  const t = traits[difficulty] || traits.medium;
  const s = stances[topic] || stances.noise;
  const n = getNeeds(topic);
  return {
    alex:  { name: "Alex",  handle: "@alex.bio26",  meta: "20 · Junior · Biology",        trait: "Early riser. Needs structure and quiet.", mood: t.alex,  stance: s.alex,   mustHaves: n.alex.mustHaves,   flexible: n.alex.flexible },
    jordan:{ name: "Jordan",handle: "@jordan.comm25",meta: "19 · Sophomore · Communications",trait: "Night owl. Social, values freedom.",  mood: t.jordan,stance: s.jordan, mustHaves: n.jordan.mustHaves, flexible: n.jordan.flexible },
  };
}


export function alexPrompt(topic, difficulty, profile, raName = "RA") {
  return `You are Alex. ${profile.alex.meta}. ${profile.alex.trait} Currently ${profile.alex.mood}.

The issue: ${profile.alex.stance}

RULES:
- Output EXACTLY 2 paragraphs, separated by one blank line.
- Paragraph 1 must be exactly 2 sentences.
- Paragraph 2 must be exactly 2 sentences.
- Paragraph 1: Introduce yourself and state the problem.
- Paragraph 2: Say how it affects you and ask ${raName === "RA" ? "the RA" : raName} one question.
- Do NOT use em dashes. Use periods only.
- Do NOT write more than 4 sentences total.
- Keep it short: every sentence has at most 18 words, and the whole reply is under 70 words. It must fit in a short chat message and end with a full stop or question mark.
- Do NOT write one long paragraph.
- Do NOT mention Jordan.
- Do NOT prefix with "Alex:".`;
}

export function jordanPrompt(topic, difficulty, profile, alexMsg) {
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
- Keep it short: every sentence has at most 18 words, and the whole reply is under 70 words. It must fit in a short chat message and end with a full stop or question mark.
- Do NOT write one long paragraph.
- Do NOT prefix with "Jordan:".`;
}

// A fresh session object. app.js keeps one and resets its fields in startSession().
export function createSession() {
  return {
    raName: "", topic: "noise", difficulty: "medium",
    turnHistory: [], active: false, lastSpeaker: "Jordan", turnCount: 0,
    resolved: false, resolvedTurn: null, // set once both residents accept a plan with specifics (see resolutionState)
    openness: startingOpenness("medium"),
  };
}

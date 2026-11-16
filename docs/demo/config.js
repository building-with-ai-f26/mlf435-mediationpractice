// Settings, resident profiles, resident prompts and session shape. No DOM, no network, no storage,
// so app.js, mock.js, tests and Node scripts can all import this file.

// Keep in sync with server.mjs (ALLOWED_MODELS). The two lists must match.
export const MAIN_MODEL = "deepseek/deepseek-chat";
export const GRADER_MODELS = [
  { id: "deepseek/deepseek-chat", name: "DeepSeek" },
  { id: "anthropic/claude-haiku-5.5", name: "Claude" },
  { id: "google/gemini-2.5-flash",     name: "Gemini" },
];
export const TOKENS_RESIDENT = 150;
export const TOKENS_GRADER = 1500;
// Graders: deterministic, and no hidden reasoning (Haiku spent its whole 600 token budget on it in tools/probe-models.mjs).
export const GRADER_OPTS = { maxTokens: TOKENS_GRADER, temperature: 0, reasoning: { enabled: false } };
export const MAX_TURNS = 10;

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
  };
  const t = traits[difficulty] || traits.medium;
  const s = stances[topic] || stances.noise;
  return {
    alex:  { name: "Alex",  handle: "@alex.bio26",  meta: "20 · Junior · Biology",        trait: "Early riser. Needs structure and quiet.", mood: t.alex,  stance: s.alex },
    jordan:{ name: "Jordan",handle: "@jordan.comm25",meta: "19 · Sophomore · Communications",trait: "Night owl. Social, values freedom.",  mood: t.jordan,stance: s.jordan},
  };
}


export function alexPrompt(topic, difficulty, profile) {
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
- Do NOT write one long paragraph.
- Do NOT prefix with "Jordan:".`;
}

// A fresh session object. app.js keeps one and resets its fields in startSession().
export function createSession() {
  return {
    raName: "", topic: "noise", difficulty: "medium",
    turnHistory: [], active: false, lastSpeaker: "Jordan", turnCount: 0,
    agreementNoticeShown: false,
  };
}

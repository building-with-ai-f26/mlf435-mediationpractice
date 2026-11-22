import { startingOpenness } from "./logic.js";

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
// Tagger: labels each RA message so resident openness can change. Same settings as the graders, small budget.
export const TAGGER_MODEL = "anthropic/claude-haiku-5.5";
export const TOKENS_TAGGER = 220; // was 150: the tagger now also returns proposal_on_table, meets_needs and plan_has_specifics
export const TAGGER_OPTS = { maxTokens: TOKENS_TAGGER, temperature: 0, reasoning: { enabled: false } };
// Router: picks who answers when the RA message names nobody. One word back, so 30 tokens is plenty.
export const ROUTER_MODEL = "anthropic/claude-haiku-5.5";
export const TOKENS_ROUTER = 30;
export const ROUTER_OPTS = { maxTokens: TOKENS_ROUTER, temperature: 0, reasoning: { enabled: false } };
export const MAX_TURNS = 10;

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
    resolved: false, resolvedTurn: null, // set once both residents accept a plan with specifics (see resolutionState)
    openness: startingOpenness("medium"),
  };
}

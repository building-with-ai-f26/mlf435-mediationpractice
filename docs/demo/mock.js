// Mock mode (?mock=1). Returns canned OpenAI-shaped responses so the whole flow
// works with zero API calls. Pure: no DOM, window, or fetch.
// Detection depends on prompt text in config.js, logic.js and rubric.js. tests/mock.test.mjs
// builds the real prompts and checks they are still recognised, so drift fails a test.

import { getProfiles } from "./config.js";

const INTRO = {
  alex: {
    easy: "Hi, I'm Alex. Jordan's late-night noise has made it hard for me to settle in.\n\nIt cuts into my sleep a few nights a week. Can you help us find something that works for both of us?",
    medium: "Hi, I'm Alex. The noise from Jordan keeps me up and I'm running on empty.\n\nMy early classes are suffering because of it. What are you going to do about this?",
    hard: "I'm Alex, and I'm at the end of my rope. Jordan ignores every request I make.\n\nI haven't slept properly in weeks. Why should I believe this meeting will change anything?",
  },
  jordan: {
    easy: "Hi, I'm Jordan. I get that Alex is frustrated, and I want to sort this out.\n\nMy evening classes just run late. I'd like us to find a fair middle ground.",
    medium: "I'm Jordan. It feels like I'm being blamed for just living my life.\n\nAlex expects total silence at 9pm, and that isn't realistic. I feel attacked right now.",
    hard: "Jordan here. I don't see why I'm being dragged into this.\n\nAlex wants me to live like a ghost in my own room. I'm done being the bad guy.",
  },
};

const REPLY = {
  alex: {
    early: {
      easy: ["Thanks for asking. Quiet after 10pm would make a real difference for me.\n\nI'm open to ideas if Jordan is."],
      medium: ["That's part of it, but it keeps happening. I need to know something will actually change.\n\nI'm tired of asking over and over."],
      hard: ["You're not hearing me. I've asked nicely and nothing changed.\n\nWhy should I trust another promise?"],
    },
    mid: {
      easy: ["I could live with some noise before 11pm. After that I really need quiet."],
      medium: ["Maybe a set time could work, but I'd need it written down.\n\nI'd want to check in after a week."],
      hard: ["Fine, I can hear that Jordan has classes. I'm still skeptical, though.\n\nWhat exactly would be different this time?"],
    },
    late: {
      easy: ["That works for me. I'll be fine with noise until 11pm starting tonight."],
      medium: ["That works for me. I'll try quiet hours after 11pm starting tonight, and we check in next week."],
      hard: ["Okay. That works for me, and I'll give quiet hours after 11pm a try starting tonight."],
    },
  },
  jordan: {
    early: {
      easy: ["I can try to be more careful, honestly. I just didn't realize how much it carried.\n\nWhat would you suggest?"],
      medium: ["I'm not the only one with a schedule here. Why is mine the one that has to change?\n\nIt feels one-sided."],
      hard: ["Of course it's all on me. I'm not doing this if it's just me getting lectured.\n\nI'm shutting this down."],
    },
    mid: {
      easy: ["I could wear headphones after 11pm. That seems fair to me."],
      medium: ["If Alex bends on the early evening, I can look at keeping it down later at night.\n\nI'm listening."],
      hard: ["Okay, maybe there's something there. I won't promise anything yet.\n\nWhat would I get out of this?"],
    },
    late: {
      easy: ["Deal. I'll use headphones after 11pm starting tonight."],
      medium: ["That works for me. I'll keep it down after 11pm on weeknights starting tonight."],
      hard: ["Fine. That works for me, and I'll keep it quiet after 11pm starting tonight."],
    },
  },
};

// Which rubric questions each mock grader answers YES to. They differ on purpose,
// so the debrief shows a mix of 3 of 3, 2 of 3 and 1 of 3 agreement.
const MOCK_YES = {
  "deepseek/deepseek-chat": [1, 3, 4, 6, 8, 9, 10, 11, 12],
  "anthropic/claude-haiku-5.5": [1, 3, 4, 5, 8, 9, 10, 11, 13, 14],
  "google/gemini-2.5-flash": [1, 2, 3, 4, 8, 9, 10, 12, 15],
};

// Quote the first 12 words of a real RA line from the prompt's transcript, so evidence checks pass.
// If the RA wrote nothing, every answer is NO.
function mockRubricReply(prompt, model) {
  const quotes = prompt.split("\n")
    .filter(l => l.startsWith("RA: "))
    .map(l => l.slice(4).trim().split(/\s+/).slice(0, 12).join(" "))
    .filter(Boolean);
  const yes = MOCK_YES[model] || MOCK_YES["deepseek/deepseek-chat"];
  const lines = [];
  for (let id = 1; id <= 15; id++) {
    const i = yes.indexOf(id);
    lines.push(i >= 0 && quotes.length ? `Q${id}: YES | ${quotes[i % quotes.length]}` : `Q${id}: NO`);
  }
  return lines.join("\n");
}

function promptText(messages) {
  return (messages || []).map(m => String(m.content || "")).join("\n");
}

// The resident prompts embed each difficulty's mood text, taken from the real getProfiles().
function difficultyFromMood(prompt) {
  const text = prompt.toLowerCase();
  for (const d of ["hard", "easy"]) {
    const p = getProfiles("noise", d);
    if (text.includes(p.alex.mood.toLowerCase()) || text.includes(p.jordan.mood.toLowerCase())) return d;
  }
  return "medium";
}

// Which kind of prompt is this? Exported so tests can check detection.
export function classifyPrompt(prompt) {
  if (/Score this RA mediation practice session with a yes\/no checklist/i.test(prompt)) return "rubric";
  if (/Introduce yourself/i.test(prompt)) return /^You are Jordan\./.test(prompt) ? "jordan-intro" : "alex-intro";
  if (/^You are (Alex|Jordan)\./.test(prompt) && /CONVERSATION:/.test(prompt)) return "mediation";
  return "unknown";
}

function mockText(prompt, model) {
  const kind = classifyPrompt(prompt);
  if (kind === "rubric") return mockRubricReply(prompt, model);
  const mood = difficultyFromMood(prompt);
  if (kind === "alex-intro") return INTRO.alex[mood];
  if (kind === "jordan-intro") return INTRO.jordan[mood];
  if (kind === "mediation") {
    const who = /^You are Alex\./.test(prompt) ? "alex" : "jordan";
    const stage = /CRITICAL:/.test(prompt) ? "late" : /IMPORTANT:/.test(prompt) ? "mid" : "early";
    const options = REPLY[who][stage][mood];
    return options[0];
  }
  return "Mock mode: unrecognized prompt.\n\nNo API call was made.";
}

// Same shape as an OpenRouter chat completion, including usage.
export function mockResponse(model, messages) {
  const prompt = promptText(messages);
  const content = mockText(prompt, model);
  const promptTokens = Math.ceil(prompt.length / 4);
  const completionTokens = Math.ceil(content.length / 4);
  return {
    choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
  };
}

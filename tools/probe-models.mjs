// Probe the three grader models with the app's grader prompt. Usage: node tools/probe-models.mjs [--dry]
import fs from "fs";

const DRY = process.argv.includes("--dry");
const MODELS = ["deepseek/deepseek-chat", "anthropic/claude-haiku-5.5", "google/gemini-2.5-flash"];
const SETTINGS = { a: { max_tokens: 600, temperature: 0.8 }, b: { max_tokens: 2000, temperature: 0 } };

const key = (fs.existsSync(".env") && fs.readFileSync(".env", "utf-8").match(/^OPENROUTER_API_KEY=(.+)$/m)?.[1].trim()) || "";
if (!key && !DRY) { console.error("OPENROUTER_API_KEY not found in .env"); process.exit(1); }

const history = [
  { sender: "RA", text: "Hi both. So I heard there is a problem with noise. What is going on?" },
  { sender: "Alex", text: "Jordan comes in after 11pm and slams the door and talks on the phone. I can't sleep and I have an 8am class." },
  { sender: "RA", text: "That sounds annoying. Jordan, can you just be quieter at night?" },
  { sender: "Jordan", text: "I work late and have evening labs. I can't help when I get back, and Alex acts like I'm doing it on purpose." },
  { sender: "RA", text: "Okay. Alex, maybe try earplugs? Then we can all move on." },
  { sender: "Alex", text: "Earplugs? I shouldn't have to buy stuff because Jordan is inconsiderate." },
];
const topic = "Noise and quiet hours", difficulty = "Medium";

// Copied from graderPrompt() in public/app.js. Keep in sync.
const transcript = history.map(h => `${h.sender}: ${h.text}`).join("\n");
const prompt = `Grade this RA mediation practice session.

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

const rows = [];
for (const model of MODELS) {
  for (const [name, s] of Object.entries(SETTINGS)) {
    const body = { model, messages: [{ role: "system", content: prompt }], ...s };
    if (DRY) { console.log(`--- ${model} (${name}) ---\n${JSON.stringify({ ...body, messages: "[grader prompt, " + prompt.length + " chars]" })}`); continue; }
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      });
      const text = await res.text();
      let d = {}; try { d = JSON.parse(text); } catch {}
      const c = d.choices?.[0], m = c?.message, u = d.usage || {};
      if (!res.ok || d.error || !c) console.error(`ERROR ${model} (${name}) HTTP ${res.status}: ${text}`);
      const content = typeof m?.content === "string" ? m.content : "";
      rows.push({
        model: model.split("/")[1], set: name, http: res.status, finish: c?.finish_reason ?? "-",
        len: content.length, reasoning: !!(m?.reasoning || m?.reasoning_details?.length),
        tokens: `${u.prompt_tokens ?? "?"}/${u.completion_tokens ?? "?"}/${u.completion_tokens_details?.reasoning_tokens ?? "?"}`,
        first150: content.slice(0, 150).replace(/\n/g, "\\n"),
      });
    } catch (e) {
      console.error(`ERROR ${model} (${name}): ${e.message}`);
      rows.push({ model: model.split("/")[1], set: name, http: "ERR", finish: "-", len: 0, reasoning: false, tokens: "-", first150: e.message });
    }
  }
}
if (!DRY) { console.log("tokens = prompt/completion/reasoning"); console.table(rows); }

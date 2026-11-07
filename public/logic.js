// Pure functions. No DOM, window, or localStorage access, so tests can import this file.

// Decide which resident answers the RA's message.
// Only one name mentioned: that resident. Both or neither: the resident who did not speak last.
export function getResponder(raText, lastSpeaker) {
  const text = String(raText || "");
  const alex = /\balex\b/i.test(text);
  const jordan = /\bjordan\b/i.test(text);
  if (alex && !jordan) return "Alex";
  if (jordan && !alex) return "Jordan";
  return lastSpeaker === "Alex" ? "Jordan" : "Alex";
}

export function buildRequestBody(model, messages, maxTokens) {
  return { model, messages, temperature: 0.8, max_tokens: maxTokens };
}

export function extractContent(data) {
  if (!data || !Array.isArray(data.choices) || data.choices.length === 0 || !data.choices[0].message) {
    throw new Error("Empty model response");
  }
  const content = data.choices[0].message.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("Empty model response");
  }
  return content.trim();
}

export function mediationPrompt(topic, difficulty, history, speaker, turnCount, profile) {
  const speakerKey = speaker.toLowerCase();
  const p = profile[speakerKey];
  const transcript = history.map(h => `${h.sender}: ${h.text}`).join("\n");

  let pressure = "";
  if (turnCount >= 6) {
    pressure = "\n\nCRITICAL: This is turn 6+. You MUST show willingness to agree to a compromise. Do not resist anymore.";
  } else if (turnCount >= 4) {
    pressure = "\n\nIMPORTANT: Start showing openness to compromise. Do not just repeat your position.";
  }

  return `You are ${p.name}. ${p.meta}. ${p.trait} Currently ${p.mood}.

Your stance: ${p.stance}

CONVERSATION:
${transcript}${pressure}

RULES:
- MAXIMUM 2 paragraphs.
- MAXIMUM 4 sentences total.
- If you write more than 2 paragraphs, your response will be cut off.
- Address the RA directly.
- Do NOT use em dashes. Use periods or commas only.
- Do NOT prefix with "${p.name}:".
- Respond naturally in 2-4 sentences only.`;
}

// Record a finished turn. Called only after the resident reply succeeded, so a failed
// request leaves history, turn count, and last speaker untouched.
export function commitTurn(session, raEntry, speaker, replyText) {
  session.turnHistory.push(raEntry, { sender: speaker, text: replyText });
  session.turnCount += 1;
  session.lastSpeaker = speaker;
}

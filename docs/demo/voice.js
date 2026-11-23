// Practice mode and the live transcript view. No network, no audio here: app.js owns those.
// The same live line is meant to show the RA's spoken words while they speak, once push-to-talk exists:
// call line.update(partialText) as words arrive and line.finish(finalText) at the end. finalText is the stored message.
import { PRACTICE_MODES, DEFAULT_PRACTICE_MODE, MAX_TTS_CHARS } from "./config.js";

const MODE_KEY = "ra_practice_mode";
const MUTE_KEY = "ra_voice_muted";

export const normalizeMode = v => (PRACTICE_MODES.includes(v) ? v : DEFAULT_PRACTICE_MODE);

// Storage failures (private window, blocked site data) fall back to the defaults.
export function readStoredMode(storage) {
  try { return normalizeMode(storage.getItem(MODE_KEY)); } catch { return DEFAULT_PRACTICE_MODE; }
}
export function writeStoredMode(storage, mode) {
  try { storage.setItem(MODE_KEY, normalizeMode(mode)); } catch { /* ignore */ }
}
export function readStoredMuted(storage) {
  try { return storage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}
export function writeStoredMuted(storage, muted) {
  try { storage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch { /* ignore */ }
}

// The text sent to read-aloud: at most MAX_TTS_CHARS, cut at a sentence end when there is one.
export function ttsText(text, max = MAX_TTS_CHARS) {
  const t = String(text).trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return (end > max / 3 ? cut.slice(0, end + 1) : cut).trim();
}

// About 2.6 spoken words a second, used only when the audio length is not known.
export function estimateDurationMs(text) {
  const words = String(text).trim().split(/\s+/).filter(Boolean).length;
  return Math.max(800, Math.round((words / 2.6) * 1000));
}

// Share of the speech that has played, 0 to 1. Text runs slightly ahead of the voice so it never lags.
export function revealFraction(elapsedMs, durationMs) {
  if (!(durationMs > 0)) return 1;
  return Math.min(1, Math.max(0, elapsedMs / (durationMs * 0.95)));
}

// The first part of the text covering `fraction` of its words, keeping the original spacing.
export function revealText(text, fraction) {
  const parts = String(text).split(/(\s+)/); // words and the spaces between them
  const words = parts.filter((_, i) => i % 2 === 0 && parts[i] !== "").length;
  const shown = Math.ceil(words * Math.min(1, Math.max(0, fraction)));
  let out = "", n = 0;
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0 && parts[i] !== "") { if (n === shown) break; n++; }
    out += parts[i];
  }
  return out.trimEnd();
}

// One chat message whose text can grow. type is "alex", "jordan" or "ra". Used for every message in voice mode.
export function createLiveLine(doc, { sender, type }) {
  const el = doc.createElement("div");
  el.className = `message ${type} live`;
  const head = doc.createElement("div");
  head.className = "msg-head";
  const lbl = doc.createElement("span");
  lbl.className = "msg-sender";
  lbl.textContent = sender;
  const controls = doc.createElement("span");
  controls.className = "msg-controls";
  head.append(lbl, controls);
  const body = doc.createElement("div");
  body.className = "msg-body";
  el.append(head, body);
  return {
    el, controls,
    update(text) { body.textContent = text; },
    finish(finalText) { body.textContent = finalText; el.classList.remove("live"); },
  };
}

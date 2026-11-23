// Text to speech providers for POST /api/tts. The route never stores the text or the audio.
// TTS_PROVIDER picks one: "stub" (tests and local trials, silent audio) or empty (voice off).
// The real provider is added here later as another case in createTtsProvider.
// A provider is { name, synthesize({ text, voiceId }) -> Promise<Buffer of audio/mpeg> }.

// Three silent MPEG-1 Layer 3 frames. Decodes everywhere, plays nothing.
const FRAME = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(413)]);
export const STUB_AUDIO = Buffer.concat([FRAME, FRAME, FRAME]);

// Returns a provider, or null when voice is off. Throws on a name it does not know.
export function createTtsProvider(name) {
  const n = String(name ?? "").trim().toLowerCase();
  if (n === "" || n === "none" || n === "off") return null;
  if (n === "stub") {
    // Remembers only the voice id of the last call, so a test can check the right voice was used. Never the text.
    const p = { name: "stub", lastVoiceId: null, async synthesize({ voiceId }) { p.lastVoiceId = voiceId; return STUB_AUDIO; } };
    return p;
  }
  throw new Error(`Unknown TTS_PROVIDER "${n}"`);
}

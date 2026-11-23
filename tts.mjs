// Text to speech providers for POST /api/tts. The route never stores the text or the audio.
// TTS_PROVIDER picks one: "stub" (tests and local trials, silent audio) or empty (voice off).
// The real provider is added here later as another case in createTtsProvider.
// A provider is { name, synthesize({ text, voiceId }) -> Promise<Buffer of audio/mpeg> }.

// Three silent MPEG-1 Layer 3 frames. Decodes everywhere, plays nothing.
const FRAME = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(413)]);
export const STUB_AUDIO = Buffer.concat([FRAME, FRAME, FRAME]);

// Voice models that must not be used: OpenAI tts-1, tts-1-hd, gpt-4o-mini-tts and gpt-realtime-mini are retiring,
// and Gemini 3.1 Flash Live Preview has been shut down. A provider name or model id matching one of these is refused.
const RETIRED_VOICE = [/(^|[\/\s_-])tts-1(-hd)?($|[\s_-])/i, /gpt-4o-mini-tts/i, /gpt-realtime-mini/i, /gemini-3\.1-flash-live/i];
export const isRetiredVoiceModel = id => RETIRED_VOICE.some(re => re.test(String(id ?? "")));
function refuseRetired(name) {
  if (isRetiredVoiceModel(name)) throw new Error(`"${name}" is a retired voice model and cannot be used`);
}

// Returns a provider, or null when voice is off. Throws on a name it does not know.
export function createTtsProvider(name) {
  const n = String(name ?? "").trim().toLowerCase();
  refuseRetired(n);
  if (n === "" || n === "none" || n === "off") return null;
  if (n === "stub") {
    // Remembers only the voice id of the last call, so a test can check the right voice was used. Never the text.
    const p = { name: "stub", lastVoiceId: null, async synthesize({ voiceId }) { p.lastVoiceId = voiceId; return STUB_AUDIO; } };
    return p;
  }
  throw new Error(`Unknown TTS_PROVIDER "${n}"`);
}

// Speech to text for POST /api/stt. STT_PROVIDER: "stub" (the default), or off/none to turn it off.
// A provider is { name, streaming, transcribe({ audio: Buffer, mime }) -> Promise<string> }. It must not keep the audio.
// The real provider is added here later. streaming is false for the stub: words arrive after the clip, not while speaking.
export function createSttProvider(name) {
  const n = String(name ?? "stub").trim().toLowerCase() || "stub";
  refuseRetired(n);
  if (n === "none" || n === "off") return null;
  if (n === "stub") {
    // Remembers only how many bytes the last clip had, so a test can check it arrived. Never the audio.
    const p = { name: "stub", streaming: false, lastSize: null, async transcribe({ audio }) { p.lastSize = audio.length; return "This is a stub transcript."; } };
    return p;
  }
  throw new Error(`Unknown STT_PROVIDER "${n}"`);
}

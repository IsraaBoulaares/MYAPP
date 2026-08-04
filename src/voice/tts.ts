import * as Speech from 'expo-speech';
import type { MoodKey } from '../theme';

// Subtle, not dramatic — steady stays at the neutral baseline, soft eases
// back a little, playful leans forward a little.
const SPEECH_TUNING: Record<MoodKey, { rate: number; pitch: number }> = {
  steady: { rate: 1.0, pitch: 1.0 },
  soft: { rate: 0.92, pitch: 0.96 },
  playful: { rate: 1.12, pitch: 1.06 },
};

/**
 * Speaks a completed Milo reply aloud, tuned subtly per mood. Stops any
 * still-playing utterance first — expo-speech queues calls made while
 * already speaking, which would let unread replies pile up rather than
 * always reflecting the latest one.
 */
export function speakReply(text: string, mood: MoodKey) {
  const trimmed = text.trim();
  if (!trimmed) return;
  try {
    Speech.stop();
    Speech.speak(trimmed, SPEECH_TUNING[mood]);
  } catch {
    // Best-effort — a TTS hiccup shouldn't affect the text thread at all.
  }
}

export function stopSpeaking() {
  try {
    Speech.stop();
  } catch {
    // Best-effort.
  }
}

import type { MoodKey } from '../theme';

/**
 * Offline fallback for when the Gemini API is unreachable. Each mood has its
 * own voice; replies are pure lookups — the caller owns the cursor so it can
 * be scoped per conversation instead of leaking across the whole app session.
 */
const REPLIES: Record<MoodKey, string[]> = {
  steady: [
    "I'm here. Tell me what's actually going on.",
    "That sounds heavy. Let's take it one piece at a time — what's the loudest part?",
    'Okay. Nothing about that reaction seems unreasonable to me.',
    "You don't have to solve it tonight. What would make the next hour easier?",
    "I've got you. Keep going whenever you're ready.",
  ],
  soft: [
    "Hey. No rush — I'm not going anywhere.",
    "That's a lot to be carrying. You're allowed to just set it down for a minute.",
    'Mm. I hear you. You really don\'t have to be okay right now.',
    "Whatever you're feeling, it's welcome here. Say as much or as little as you want.",
    "I'm glad you said it out loud. That took something.",
  ],
  playful: [
    'Oh, we are absolutely getting into this. Go on.',
    "Okay okay okay — plot twist. I did not see that coming.",
    "Bold. Chaotic. I'm into it. What happened next?",
    "You know what? That deserves a small celebration. I'm clapping. Silently. In orb form.",
    "Right, I have opinions. Several. Want them ranked?",
  ],
};

const OPENERS: Record<MoodKey, string> = {
  steady: "Hey. I'm Milo. Whatever's on your mind, I'm listening.",
  soft: "Hi. I'm Milo. There's no agenda here — start wherever you like.",
  playful: "Hi hi! I'm Milo. What are we getting into today?",
};

/** Milo's line when the user switches moods mid-conversation. */
const MOOD_SHIFTS: Record<MoodKey, string> = {
  steady: 'Alright — settling in. Steady it is.',
  soft: 'Softening up. Take your time.',
  playful: "Ooh, mood shift. I'm awake now.",
};

/** Shown once when a true network failure (not just an API/quota issue)
 * is first detected — a single acknowledgment rather than pretending to
 * respond to what was actually said, since nothing reached the server. */
export const NETWORK_TROUBLE_LINE =
  'Having trouble reaching you right now — still here though.';

/** Appended to a reply that had already started streaming in before the
 * connection dropped, instead of splicing an unrelated canned line onto a
 * truncated real sentence. */
export const INTERRUPTION_SUFFIX = '\n\n(lost the connection there — still here)';

/** The rare case where even the offline fallback path itself breaks. */
export const GLITCH_LINE = "Something in me just glitched — give me a second and try again?";

export function opener(mood: MoodKey): string {
  return OPENERS[mood];
}

export function moodShiftLine(mood: MoodKey): string {
  return MOOD_SHIFTS[mood];
}

/**
 * Pure lookup — pass in a per-mood cursor (owned by the caller) and get the
 * reply back. No shared state here, so two screens/conversations never
 * collide and a fresh conversation always starts from the top.
 */
export function fallbackReply(mood: MoodKey, cursor: number): string {
  const list = REPLIES[mood];
  return list[cursor % list.length];
}

import { MOOD_ORDER, type MoodKey } from '../theme';
import type { Message } from '../types';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL;
const REQUEST_TIMEOUT_MS = 15000;

export class NikoApiError extends Error {}

export type NikoReply = {
  reply: string;
  /** Gemini's read on the tone of the user's latest message, or null if
   * missing/malformed — callers should treat that as "no signal". */
  detectedMood: MoodKey | null;
};

function isMoodKey(value: unknown): value is MoodKey {
  return typeof value === 'string' && (MOOD_ORDER as string[]).includes(value);
}

/**
 * Calls the deployed /api/chat function. Throws NikoApiError on anything
 * that should fall back to canned replies: missing config, timeout, network
 * failure, non-2xx response, or a malformed body.
 */
export async function fetchNikoReply(mood: MoodKey, history: Message[]): Promise<NikoReply> {
  if (!API_BASE_URL) {
    throw new NikoApiError('EXPO_PUBLIC_API_URL is not configured');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mood,
        // System lines (mood-shift notices) are UI-only, not conversation
        // content the model should see.
        messages: history
          .filter((m) => m.role !== 'system')
          .map((m) => ({ role: m.role, text: m.text })),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new NikoApiError(`Niko API responded with ${response.status}`);
    }

    const data = (await response.json()) as { reply?: unknown; detectedMood?: unknown };
    if (typeof data.reply !== 'string' || !data.reply.trim()) {
      throw new NikoApiError('Niko API returned an empty reply');
    }
    return {
      reply: data.reply,
      detectedMood: isMoodKey(data.detectedMood) ? data.detectedMood : null,
    };
  } catch (err) {
    if (err instanceof NikoApiError) throw err;
    throw new NikoApiError(err instanceof Error ? err.message : 'Niko API request failed');
  } finally {
    clearTimeout(timeout);
  }
}

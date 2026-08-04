import AsyncStorage from '@react-native-async-storage/async-storage';
import { MOOD_ORDER, type MoodKey } from '../theme';
import type { Message } from '../types';

const STORAGE_KEY = '@milo/chat-history';

type PersistedState = {
  messages: Message[];
  mood: MoodKey;
};

function isMoodKey(value: unknown): value is MoodKey {
  return typeof value === 'string' && (MOOD_ORDER as string[]).includes(value);
}

function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    (v.role === 'user' || v.role === 'milo' || v.role === 'system') &&
    typeof v.text === 'string' &&
    isMoodKey(v.mood)
  );
}

/** Returns saved history + mood, or null if there's none yet, or it's corrupt. */
export async function loadChatHistory(): Promise<PersistedState | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { messages?: unknown; mood?: unknown };
    if (!Array.isArray(parsed.messages) || !parsed.messages.every(isMessage)) return null;
    if (!isMoodKey(parsed.mood)) return null;
    return { messages: parsed.messages, mood: parsed.mood };
  } catch {
    return null;
  }
}

/** Mood-shift narration lines are ephemeral UI notices, not conversation —
 * only real user/milo turns are worth restoring after a restart. */
export async function saveChatHistory(messages: Message[], mood: MoodKey): Promise<void> {
  const persistable = messages.filter((m) => m.role !== 'system');
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ messages: persistable, mood }));
  } catch {
    // Best-effort — losing persistence shouldn't break the live conversation.
  }
}

export async function clearChatHistory(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort.
  }
}

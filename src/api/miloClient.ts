import { MOOD_ORDER, type MoodKey } from '../theme';
import type { Message } from '../types';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL;
const REQUEST_TIMEOUT_MS = 20000;

/** 'network' = request never reached/heard back from the server at all —
 * caller should treat this differently from a real (if unhappy) response.
 * 'api' = server responded, but with a failure (bad status, quota, empty
 * reply, mid-stream interruption). */
export type MiloFailureKind = 'network' | 'api';

export class MiloApiError extends Error {
  kind: MiloFailureKind;
  constructor(message: string, kind: MiloFailureKind = 'api') {
    super(message);
    this.kind = kind;
  }
}

export type MiloStreamHandlers = {
  onDelta: (deltaText: string) => void;
  onDone: (detectedMood: MoodKey | null) => void;
  onError: (error: MiloApiError) => void;
};

function isMoodKey(value: unknown): value is MoodKey {
  return typeof value === 'string' && (MOOD_ORDER as string[]).includes(value);
}

/**
 * Streams a reply from /api/chat, invoking handlers as NDJSON events arrive
 * (one JSON object per line: {type:'delta'|'done'|'error', ...}). Uses
 * XMLHttpRequest rather than fetch — React Native's fetch does not reliably
 * expose a readable stream for the response body across RN/Hermes versions,
 * while XHR's progressive `responseText` + `onprogress` is the established,
 * reliable way to consume a streaming HTTP response in RN.
 *
 * Returns a cancel function (aborts the in-flight request; safe to call
 * after the stream has already finished).
 */
export function streamMiloReply(
  mood: MoodKey,
  history: Message[],
  handlers: MiloStreamHandlers,
): () => void {
  if (!API_BASE_URL) {
    handlers.onError(new MiloApiError('EXPO_PUBLIC_API_URL is not configured', 'api'));
    return () => {};
  }

  const xhr = new XMLHttpRequest();
  let processedLength = 0;
  let lineBuffer = '';
  let settled = false;

  const finish = (fn: () => void) => {
    if (settled) return;
    settled = true;
    fn();
  };

  const processNewText = () => {
    const text: string = xhr.responseText ?? '';
    if (text.length <= processedLength) return;
    const newText = text.slice(processedLength);
    processedLength = text.length;

    lineBuffer += newText;
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() ?? '';

    for (const line of lines) {
      if (settled) return;
      const trimmed = line.trim();
      if (!trimmed) continue;

      let event: { type?: unknown; text?: unknown; detectedMood?: unknown; message?: unknown };
      try {
        event = JSON.parse(trimmed);
      } catch {
        continue; // Skip a malformed line rather than failing the whole stream.
      }

      if (event.type === 'delta' && typeof event.text === 'string') {
        handlers.onDelta(event.text);
      } else if (event.type === 'done') {
        finish(() => handlers.onDone(isMoodKey(event.detectedMood) ? event.detectedMood : null));
      } else if (event.type === 'error') {
        finish(() =>
          handlers.onError(
            new MiloApiError(typeof event.message === 'string' ? event.message : 'Stream error', 'api'),
          ),
        );
      }
    }
  };

  xhr.onprogress = processNewText;
  xhr.onload = () => {
    processNewText();
    if (settled) return;
    // Connection closed without a 'done' or 'error' event ever arriving —
    // whatever text streamed in (if any) is incomplete, so treat it as a
    // failure rather than silently leaving a half-finished bubble.
    if (xhr.status >= 200 && xhr.status < 300) {
      finish(() => handlers.onError(new MiloApiError('Stream ended unexpectedly', 'api')));
    } else {
      finish(() =>
        handlers.onError(new MiloApiError(`Milo API responded with ${xhr.status}`, 'api')),
      );
    }
  };
  xhr.onerror = () => finish(() => handlers.onError(new MiloApiError('Network error', 'network')));
  xhr.ontimeout = () =>
    finish(() => handlers.onError(new MiloApiError('Milo API request timed out', 'network')));
  xhr.timeout = REQUEST_TIMEOUT_MS;

  xhr.open('POST', `${API_BASE_URL}/api/chat`);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.send(
    JSON.stringify({
      mood,
      // System lines (mood-shift notices) are UI-only, not conversation
      // content the model should see.
      messages: history
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role, text: m.text })),
    }),
  );

  return () => {
    if (!settled) {
      settled = true;
      xhr.abort();
    }
  };
}

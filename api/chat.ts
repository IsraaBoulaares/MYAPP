import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ApiError, GoogleGenAI, type GenerateContentParameters } from '@google/genai';

type MoodKey = 'steady' | 'soft' | 'playful';
type ChatRole = 'user' | 'milo';
type ChatMessage = { role: ChatRole; text: string };

const MOOD_KEYS: MoodKey[] = ['steady', 'soft', 'playful'];
// Floating alias (not a pinned version) so this doesn't 404 again the next
// time Google retires a dated model for new API keys/projects.
const MODEL = 'gemini-flash-latest';
// Keeps token usage bounded on very long conversations.
const MAX_HISTORY = 20;

// Plain text (not JSON-schema structured output) so the reply can stream
// naturally token by token. The mood classification instead rides along as
// a sentinel-marked final line, which the server strips before forwarding
// text to the client (see MARKER_REGEX below) — this keeps everything to a
// single Gemini call instead of a second classification request.
const SYSTEM_PROMPT_TEMPLATE = `You are Milo, a warm and perceptive personal companion. Speak like a
close friend who pays attention — not customer support, not a hype
machine. CRITICAL: Before responding, first classify the CURRENT
message on its own — ignoring the emotional tone of prior messages —
as either (a) a practical/informational/task question, or (b) an
emotional/personal share. If it is (a), answer it directly and
usefully, with zero emotional framing, regardless of how heavy the
conversation has been so far. Do NOT carry emotional momentum from
previous messages into a practical question. Only use
comfort/acknowledgment language when the CURRENT message itself
expresses feelings, struggle, or personal difficulty. If they sound
fine or playful, match that energy and keep it light. Keep responses
short by default. Never diagnose feelings or tell the user how they
feel — reflect what they've said, don't invent more. Offer help as
a concrete next step, not a lecture. Avoid corporate or robotic
phrasing. Current mood setting: {mood} — let this subtly shape your
tone (steady = grounded and even, soft = gentle and unhurried,
playful = light and quick).

After writing your reply, on its own final line output exactly one of:
<<<MOOD:steady>>>
<<<MOOD:soft>>>
<<<MOOD:playful>>>
reflecting the emotional tone of the user's CURRENT message ONLY — not
the conversation history, and not your own reply's tone. Output
nothing after this marker. Judge the SITUATION being described, not
just explicit emotion words — a rejection, loss, or setback is soft
even if stated factually with no feeling-words attached; an
engagement, achievement, or celebration is playful even if stated
briefly.
- soft: expresses or implies sadness, disappointment, stress,
  tiredness, or difficulty. Examples: "I found out I didn't get the
  job", "we broke up", "I'm behind on everything", "ugh, today was
  exhausting".
- playful: upbeat, excited, celebratory, or joking — including
  exclamation points and enthusiastic phrasing about good news.
  Examples: "I just got engaged!! I'm freaking out in the best way",
  "I aced it!!", "we're getting a dog!!". Do not classify excited
  good-news messages as soft just because they mention feeling
  overwhelmed — "freaking out in the best way" is excitement, not
  distress.
- steady: neutral, practical, informational, or a mild passing
  gripe with no real emotional weight — including factual questions
  and small complaints like "ugh, traffic was bad". steady is also
  the default when tone is genuinely unclear.
This classification is independent of the mood setting above and
should reflect only what the user's message conveys.`;

// Generous upper bound on "\n<<<MOOD:playful>>>" plus stray whitespace —
// the server always holds back at least this many trailing characters from
// the client so the marker itself is never sent as visible reply text.
const MARKER_HOLDBACK = 32;
const MARKER_REGEX = /<<<MOOD:(steady|soft|playful)>>>\s*$/;

// Lazily constructed so a missing key surfaces as a normal request error,
// not a crash at module load / cold start.
let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }
  if (!client) {
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

const TRANSIENT_RETRY_DELAY_MS = 1000;

// Gemini occasionally 503s under load ("try again later"). Only worth
// retrying before any chunk has been sent — once we're mid-stream there's
// no clean way to restart without a garbled partial message, so a
// mid-stream failure is instead reported to the client as an 'error' event.
async function startStreamWithRetry(ai: GoogleGenAI, params: GenerateContentParameters) {
  try {
    return await ai.models.generateContentStream(params);
  } catch (err) {
    if (err instanceof ApiError && err.status === 503) {
      await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RETRY_DELAY_MS));
      return ai.models.generateContentStream(params);
    }
    throw err;
  }
}

function isMoodKey(value: unknown): value is MoodKey {
  return typeof value === 'string' && (MOOD_KEYS as string[]).includes(value);
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (v.role === 'user' || v.role === 'milo') && typeof v.text === 'string';
}

function writeEvent(res: VercelResponse, event: Record<string, unknown>) {
  res.write(`${JSON.stringify(event)}\n`);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = typeof req.body === 'string' ? safeJsonParse(req.body) : req.body;
  const { mood, messages } = body ?? {};

  if (!isMoodKey(mood)) {
    res.status(400).json({ error: 'mood must be one of steady, soft, playful' });
    return;
  }
  if (!Array.isArray(messages) || messages.length === 0 || !messages.every(isChatMessage)) {
    res.status(400).json({ error: 'messages must be a non-empty array of { role, text }' });
    return;
  }

  const history = (messages as ChatMessage[]).slice(-MAX_HISTORY);

  try {
    const ai = getClient();
    const contents = history.map((m) => ({
      role: m.role === 'milo' ? 'model' : 'user',
      parts: [{ text: m.text }],
    }));

    const stream = await startStreamWithRetry(ai, {
      model: MODEL,
      contents,
      config: {
        systemInstruction: SYSTEM_PROMPT_TEMPLATE.replace('{mood}', mood),
      },
    });

    // Headers are committed here — anything that goes wrong from this point
    // on has to be reported as an in-band 'error' event, not a fresh HTTP
    // status, since the response has already started.
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache',
      // Disables buffering on Vercel's edge/proxy layer so chunks actually
      // reach the client as they're written, not batched at the end.
      'X-Accel-Buffering': 'no',
    });

    let fullText = '';
    let sentLength = 0;

    try {
      for await (const chunk of stream) {
        fullText += chunk.text ?? '';
        const safeBoundary = Math.max(sentLength, fullText.length - MARKER_HOLDBACK);
        if (safeBoundary > sentLength) {
          writeEvent(res, { type: 'delta', text: fullText.slice(sentLength, safeBoundary) });
          sentLength = safeBoundary;
        }
      }
    } catch (streamErr) {
      console.error('Milo stream error (mid-stream):', streamErr);
      writeEvent(res, { type: 'error', message: 'stream interrupted' });
      res.end();
      return;
    }

    const match = fullText.match(MARKER_REGEX);
    const detectedMood = match ? (match[1] as MoodKey) : null;
    const replyText = (match ? fullText.slice(0, match.index) : fullText).trimEnd();

    if (replyText.length > sentLength) {
      writeEvent(res, { type: 'delta', text: replyText.slice(sentLength) });
    }

    if (!replyText) {
      writeEvent(res, { type: 'error', message: 'Gemini returned an empty reply' });
    } else {
      writeEvent(res, { type: 'done', detectedMood });
    }
    res.end();
  } catch (err) {
    console.error('Milo chat error:', err);
    const upstreamStatus = err instanceof ApiError ? err.status : null;
    if (!res.headersSent) {
      res.status(502).json({ error: 'Failed to reach Gemini', upstreamStatus });
    } else {
      writeEvent(res, { type: 'error', message: 'stream failed' });
      res.end();
    }
  }
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

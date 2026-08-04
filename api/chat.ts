import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from '@google/genai';

type MoodKey = 'steady' | 'soft' | 'playful';
type ChatRole = 'user' | 'niko';
type ChatMessage = { role: ChatRole; text: string };

const MOOD_KEYS: MoodKey[] = ['steady', 'soft', 'playful'];
// Floating alias (not a pinned version) so this doesn't 404 again the next
// time Google retires a dated model for new API keys/projects.
const MODEL = 'gemini-flash-latest';
// Keeps token usage bounded on very long conversations.
const MAX_HISTORY = 20;

const SYSTEM_PROMPT_TEMPLATE = `You are Niko, a warm and perceptive personal companion. Speak like a
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

Alongside your reply, also classify the emotional tone of the user's
CURRENT message ONLY — not the conversation history — as one of
steady, soft, or playful: soft = the message expresses sadness,
stress, tiredness, or difficulty; playful = the message is upbeat,
excited, or joking; steady = the message is neutral, practical, or its
tone is unclear. This classification is independent of the mood
setting above and should reflect only what this message conveys.`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    reply: {
      type: Type.STRING,
      description: "Niko's reply to the user, following all persona and tone rules above.",
    },
    detectedMood: {
      type: Type.STRING,
      enum: MOOD_KEYS,
      description: "Emotional tone of the user's current message only, per the classification rule above.",
    },
  },
  required: ['reply', 'detectedMood'],
};

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

function isMoodKey(value: unknown): value is MoodKey {
  return typeof value === 'string' && (MOOD_KEYS as string[]).includes(value);
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (v.role === 'user' || v.role === 'niko') && typeof v.text === 'string';
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
      role: m.role === 'niko' ? 'model' : 'user',
      parts: [{ text: m.text }],
    }));

    const response = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: {
        systemInstruction: SYSTEM_PROMPT_TEMPLATE.replace('{mood}', mood),
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    });

    const raw = response.text?.trim();
    if (!raw) {
      throw new Error('Gemini returned an empty response');
    }

    const parsed = JSON.parse(raw) as { reply?: unknown; detectedMood?: unknown };
    const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : '';
    if (!reply) {
      throw new Error('Gemini returned an empty reply');
    }
    // Not fatal if missing/malformed — the client just skips auto mood-shift.
    const detectedMood = isMoodKey(parsed.detectedMood) ? parsed.detectedMood : null;

    res.status(200).json({ reply, detectedMood });
  } catch (err) {
    console.error('Niko chat error:', err);
    res.status(502).json({ error: 'Failed to reach Gemini' });
  }
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

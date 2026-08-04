// Temporary — lists Gemini models actually available to this API key, so
// we can pick a valid replacement for the retired gemini-2.5-flash. Delete
// after use.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'GEMINI_API_KEY is not configured' });
      return;
    }
    const ai = new GoogleGenAI({ apiKey });
    const pager = await ai.models.list();

    const models: { name?: string; supportedActions?: string[] }[] = [];
    for await (const model of pager) {
      models.push({ name: model.name, supportedActions: model.supportedActions });
    }

    res.status(200).json({ models });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

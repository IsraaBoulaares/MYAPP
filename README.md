# Milo

A mobile companion chat app built with Expo/React Native. Milo listens (by voice or text), replies in a warm, perceptive tone powered by Gemini, speaks its replies back with TTS, and adapts its mood — steady, soft, or playful — to how the conversation feels.

## Features

- **Chat UI** with streaming replies, typing indicator, and mood-tinted message bubbles.
- **Voice input** (speech-to-text) and **voice replies** (text-to-speech), toggleable independently.
- **Mood system** — steady / soft / playful — set manually or auto-detected from the user's message tone, with a short "wins over auto-detect" window after a manual change.
- **Offline fallback** — if the network or API fails, Milo degrades gracefully to mood-flavoured canned replies instead of going silent.
- **Local history** — conversation and mood are persisted on-device (AsyncStorage) and restored on relaunch.
- **Streaming backend** — a Vercel serverless function (`api/chat.ts`) proxies to Gemini, streaming NDJSON deltas to the client so replies render token by token.

## Project structure

```
milo/
├── App.tsx                    # Entry point
├── api/
│   └── chat.ts                # Vercel serverless function — streams Gemini replies
├── src/
│   ├── screens/ChatScreen.tsx # Main chat screen and app state
│   ├── components/            # Composer, MessageBubble, MoodToggle, TypingIndicator, VoiceOrb
│   ├── api/miloClient.ts      # Streams /api/chat via XHR (NDJSON)
│   ├── hooks/useSpeechInput.ts
│   ├── voice/tts.ts           # Text-to-speech playback
│   ├── storage/chatHistory.ts # AsyncStorage persistence
│   ├── data/cannedReplies.ts  # Offline fallback replies
│   └── theme.ts                # Mood palette/tokens
├── app.json / vercel.json
└── .env.example
```

## Getting started

### Prerequisites

- Node.js
- Expo CLI (`npx expo`)
- A Gemini API key (for the backend) — get one from [Google AI Studio](https://aistudio.google.com/)

### Setup

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

```
# Server-side only (set in the Vercel dashboard for real deploys)
GEMINI_API_KEY=your-key

# Client-side, the base URL of the deployed /api/chat backend
EXPO_PUBLIC_API_URL=https://your-project.vercel.app
```

### Run

```bash
npm start      # Expo dev server
npm run ios
npm run android
npm run web
```

The chat backend (`api/chat.ts`) is a Vercel serverless function — deploy the repo to Vercel (or run `vercel dev` locally) with `GEMINI_API_KEY` set in its environment for the app to get real replies; otherwise it runs on the offline canned fallback.

## Notes

- Without a network connection or a working backend, the app still functions using mood-based canned replies (`src/data/cannedReplies.ts`) — this is intentional, not an error state.
- `.env*.local` is gitignored; only `.env.example` (no real values) is committed.

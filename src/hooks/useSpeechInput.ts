import { useCallback, useRef, useState } from 'react';

// Loaded via a guarded require() rather than a static `import` — the native
// module isn't linked in Expo Go (it needs a custom dev client), and a
// static import would throw the moment this file loads, crashing the whole
// app at startup rather than just this feature. require() runs exactly
// where it's written, so the failure is caught right here instead.
//
// This constant is resolved once at module-eval time and never changes
// afterward, so branching on it inside the hook below is safe despite
// looking like a conditional hook call — the same branch is taken on every
// render for the lifetime of the app, which is all React's rules of hooks
// actually require.
let SpeechRecognition: typeof import('expo-speech-recognition') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  SpeechRecognition = require('expo-speech-recognition');
} catch {
  SpeechRecognition = null;
}

type Options = {
  /** Called with the latest (interim or final) transcript as the user speaks. */
  onTranscriptChange: (text: string) => void;
  /** Called once permission is confirmed denied and the user tried to use
   * the mic — not on every tap, so the explanation doesn't repeat. */
  onDenied: () => void;
  /** Called if speech recognition isn't available at all — the native
   * module isn't linked (e.g. running in Expo Go), or the device/OS
   * doesn't support it. */
  onUnavailable: () => void;
};

/**
 * Wraps expo-speech-recognition into a simple start/stop toggle. Listener
 * callbacks are read from refs so the native event subscriptions (set up
 * once by useSpeechRecognitionEvent) always call the latest version without
 * needing to tear down and resubscribe on every render.
 */
export function useSpeechInput({ onTranscriptChange, onDenied, onUnavailable }: Options) {
  const [isListening, setIsListening] = useState(false);

  const onTranscriptChangeRef = useRef(onTranscriptChange);
  onTranscriptChangeRef.current = onTranscriptChange;

  if (SpeechRecognition) {
    SpeechRecognition.useSpeechRecognitionEvent('result', (event) => {
      onTranscriptChangeRef.current(event.results[0]?.transcript ?? '');
    });
    // Both an explicit error and the recognizer naturally ending (e.g. it
    // decided speech was done) should drop back out of "listening" state —
    // otherwise the orb would keep pulsing after the mic has already closed.
    SpeechRecognition.useSpeechRecognitionEvent('error', () => setIsListening(false));
    SpeechRecognition.useSpeechRecognitionEvent('end', () => setIsListening(false));
  }

  const stop = useCallback(() => {
    SpeechRecognition?.ExpoSpeechRecognitionModule.stop();
    setIsListening(false);
  }, []);

  const start = useCallback(async () => {
    if (!SpeechRecognition) {
      onUnavailable();
      return;
    }
    try {
      const { ExpoSpeechRecognitionModule } = SpeechRecognition;
      if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        onUnavailable();
        return;
      }

      let permission = await ExpoSpeechRecognitionModule.getPermissionsAsync();
      if (!permission.granted && permission.canAskAgain) {
        permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      }
      if (!permission.granted) {
        onDenied();
        return;
      }

      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: true,
        continuous: true,
      });
      setIsListening(true);
    } catch {
      // Any unexpected failure from the native side degrades to normal
      // typing rather than leaving the composer in a broken state.
      onUnavailable();
    }
  }, [onDenied, onUnavailable]);

  const toggle = useCallback(() => {
    if (isListening) {
      stop();
    } else {
      start();
    }
  }, [isListening, start, stop]);

  return { isListening, toggle };
}

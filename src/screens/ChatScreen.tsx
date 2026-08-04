import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { streamMiloReply, type MiloFailureKind } from '../api/miloClient';
import Composer from '../components/Composer';
import MessageBubble from '../components/MessageBubble';
import MoodToggle from '../components/MoodToggle';
import TypingIndicator from '../components/TypingIndicator';
import VoiceOrb from '../components/VoiceOrb';
import {
  fallbackReply,
  GLITCH_LINE,
  INTERRUPTION_SUFFIX,
  moodShiftLine,
  NETWORK_TROUBLE_LINE,
  opener,
} from '../data/cannedReplies';
import { useSpeechInput } from '../hooks/useSpeechInput';
import { clearChatHistory, loadChatHistory, saveChatHistory } from '../storage/chatHistory';
import { MOODS, palette, type MoodKey } from '../theme';
import type { Message } from '../types';

const MIC_UNAVAILABLE_LINE = "Voice input isn't available on this device — typing works great too.";
const MIC_DENIED_LINE =
  "I can't hear you without microphone access — you can turn it on anytime in Settings. Typing works great too.";

/** Only used for the offline fallback, so its personality still comes through
 * even when Gemini is unreachable — playful answers back fast, soft takes
 * its time. Real API replies land whenever the network resolves. */
const THINK_MS: Record<MoodKey, number> = {
  steady: 1100,
  soft: 1500,
  playful: 700,
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const freshOpener = (): Message => ({
  id: 'm-opener',
  role: 'milo',
  text: opener('steady'),
  mood: 'steady',
});

// Natural height of the orb + tagline (VoiceOrb's 208px SIZE, plus the
// tagline and its spacing) — the amount of room reclaimed when it collapses.
const ORB_COLLAPSE_HEIGHT = 260;

// A manual tap wins over auto-detection for this long before Milo starts
// reading tone again on its own.
const MANUAL_OVERRIDE_MS = 2 * 60 * 1000;

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const [mood, setMood] = useState<MoodKey>('steady');
  const [thinking, setThinking] = useState(false);
  // Starts empty — populated by the hydration effect below with either
  // restored history or the fresh opener, whichever applies. Rendering
  // nothing here avoids a flash of the opener that then gets replaced.
  const [messages, setMessages] = useState<Message[]>([]);
  const [hydrated, setHydrated] = useState(false);
  // Lifted out of Composer (rather than owned internally) so voice input
  // can push live partial transcripts into the same field the user types
  // into, instead of needing a separate display.
  const [composerDraft, setComposerDraft] = useState('');

  // IDs are namespaced per app launch so a restored message from a prior
  // session (which has its own old id) can never collide with an id
  // generated in this one — nextId() alone would restart from 0 every
  // launch and collide with restored ids like "m0", "m1".
  const sessionPrefix = useRef(Date.now().toString(36)).current;
  const idRef = useRef(0);
  const nextId = () => `m-${sessionPrefix}-${idRef.current++}`;

  // Mirrors `mood` so a pending reply can read the latest value without
  // reaching into a state updater for it.
  const moodRef = useRef(mood);
  useEffect(() => {
    moodRef.current = mood;
  }, [mood]);

  // Mirrors `messages` so handleSend can build the API request body without
  // depending on (and re-creating itself for) the messages state.
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Per-mood cursor for the offline fallback, scoped to this conversation
  // instance instead of living at module scope.
  const fallbackCursor = useRef<Record<MoodKey, number>>({ steady: 0, soft: 0, playful: 0 });

  // When the user last tapped the mood toggle directly. Starts at 0 (the
  // epoch) so auto-detection is active from the very first message, before
  // any manual choice has been made.
  const lastManualChangeRef = useRef<number>(0);
  // Bumped on every auto-detected shift so MoodToggle can play its pulse cue.
  const [autoShiftPulseKey, setAutoShiftPulseKey] = useState(0);

  // True while replies are coming from the offline canned fallback instead
  // of a real Gemini stream — drives the subtle "on autopilot" status label.
  // Mirrored in a ref so async handlers can read the live value without a
  // stale closure.
  const [usingFallback, setUsingFallback] = useState(false);
  const usingFallbackRef = useRef(false);
  const setFallbackMode = (value: boolean) => {
    usingFallbackRef.current = value;
    setUsingFallback(value);
  };

  // Shown at most once per session — repeating it on every mic tap while
  // permission stays denied would just be noise, not helpful.
  const micNoticeShownRef = useRef(false);
  const { isListening: micListening, toggle: toggleMic } = useSpeechInput({
    onTranscriptChange: setComposerDraft,
    onDenied: () => {
      if (micNoticeShownRef.current) return;
      micNoticeShownRef.current = true;
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'system', text: MIC_DENIED_LINE, mood: moodRef.current },
      ]);
    },
    onUnavailable: () => {
      if (micNoticeShownRef.current) return;
      micNoticeShownRef.current = true;
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'system', text: MIC_UNAVAILABLE_LINE, mood: moodRef.current },
      ]);
    },
  });

  const mountedRef = useRef(true);
  // Cancels whatever stream is currently in flight — called on unmount so a
  // response arriving after the screen is gone can't touch dead state.
  const streamCancelRef = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      mountedRef.current = false;
      streamCancelRef.current?.();
    },
    [],
  );

  // Restores saved history + mood on launch, or falls back to the fresh
  // opener if there's none yet (first-ever launch).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadChatHistory();
      if (cancelled) return;
      if (saved && saved.messages.length > 0) {
        setMessages(saved.messages);
        setMood(saved.mood);
        moodRef.current = saved.mood;
      } else {
        setMessages([freshOpener()]);
      }
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persists after every change, once initial load has settled — guards
  // against overwriting real saved history with the empty initial state
  // before hydration completes.
  useEffect(() => {
    if (!hydrated) return;
    saveChatHistory(messages, mood);
  }, [messages, mood, hydrated]);

  const listRef = useRef<FlatList<Message>>(null);

  // Collapses the ornamental orb while the keyboard is open, so the thread
  // (not the orb) gets the screen space the keyboard takes away. Header and
  // mood toggle stay put — they're cheap and still useful while typing.
  const keyboardAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const animateTo = (toValue: number) =>
      Animated.timing(keyboardAnim, {
        toValue,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false, // height/maxHeight can't run on the native driver
      }).start();

    const onShow = Keyboard.addListener(showEvent, () => animateTo(1));
    const onHide = Keyboard.addListener(hideEvent, () => animateTo(0));
    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, [keyboardAnim]);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, []);

  useEffect(scrollToEnd, [messages, thinking, scrollToEnd]);

  const appendMiloReply = useCallback((text: string, mood: MoodKey) => {
    setMessages((prev) => [...prev, { id: nextId(), role: 'milo', text, mood }]);
  }, []);

  // Applies a detected mood only if the user hasn't manually overridden it
  // recently — manual choice wins for MANUAL_OVERRIDE_MS before Milo starts
  // reading tone on its own again. 'steady' means "no emotional signal", so
  // it never triggers a shift — only genuine soft/playful detections do.
  // Updates moodRef.current synchronously (not just via the mood-state
  // effect) so the reply about to be appended in this same round trip
  // already reflects the shift, instead of lagging a message behind.
  const maybeAutoShiftMood = useCallback((detected: MoodKey | null) => {
    if (!detected || detected === 'steady' || detected === moodRef.current) return;
    const sinceManualChange = Date.now() - lastManualChangeRef.current;
    if (sinceManualChange < MANUAL_OVERRIDE_MS) return;

    moodRef.current = detected;
    setMood(detected);
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: 'system', text: moodShiftLine(detected), mood: detected },
    ]);
    setAutoShiftPulseKey((k) => k + 1);
  }, []);

  const appendInterruptionNote = useCallback((replyId: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === replyId ? { ...m, text: `${m.text}${INTERRUPTION_SUFFIX}` } : m)),
    );
  }, []);

  const handleSend = useCallback(
    (text: string) => {
      // A message can be sent while the mic is still open (e.g. tapping the
      // composer's own send button mid-dictation) — make sure the session
      // actually closes rather than leaving it capturing audio in the
      // background with the orb still pulsing as if listening.
      if (micListening) toggleMic();

      const moodAtSend = moodRef.current;
      const userMessage: Message = { id: nextId(), role: 'user', text, mood: moodAtSend };
      // The user's own message is appended immediately, before anything
      // that could fail — whatever happens to the reply, what they typed
      // stays visible in the thread rather than being lost.
      const historyForApi = [...messagesRef.current, userMessage];
      setMessages((prev) => [...prev, userMessage]);
      setThinking(true);

      const replyId = nextId();
      let replyStarted = false;

      // Runs the offline degrade path for a failed reply. `kind` decides
      // the wording (a real network failure gets a one-time "having
      // trouble reaching you" line; an API/quota failure — or a repeat
      // network failure once already in fallback mode — just cycles the
      // normal mood-flavoured canned replies). If a partial reply had
      // already streamed in, it's marked as interrupted rather than
      // having an unrelated canned line spliced onto a truncated sentence.
      const fallBack = async (kind: MiloFailureKind) => {
        try {
          const wasAlreadyFallback = usingFallbackRef.current;
          setFallbackMode(true);
          const current = moodRef.current;
          await wait(THINK_MS[current]);
          if (!mountedRef.current) return;

          if (replyStarted) {
            appendInterruptionNote(replyId);
          } else if (kind === 'network' && !wasAlreadyFallback) {
            appendMiloReply(NETWORK_TROUBLE_LINE, current);
          } else {
            const cursor = fallbackCursor.current[current];
            fallbackCursor.current[current] = cursor + 1;
            appendMiloReply(fallbackReply(current, cursor), current);
          }
        } catch (fallbackErr) {
          // Tier 3 — even the offline fallback path broke. Rare (it's pure
          // local logic with no I/O besides AsyncStorage), but don't let it
          // leave the thread hanging with no acknowledgment at all.
          if (__DEV__) console.log('[Milo] fallback path itself failed:', fallbackErr);
          if (!mountedRef.current) return;
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: 'system', text: GLITCH_LINE, mood: moodRef.current },
          ]);
        } finally {
          if (mountedRef.current) setThinking(false);
        }
      };

      streamCancelRef.current = streamMiloReply(moodAtSend, historyForApi, {
        onDelta: (delta) => {
          if (!mountedRef.current) return;
          if (!replyStarted) {
            replyStarted = true;
            setThinking(false);
            setMessages((prev) => [
              ...prev,
              { id: replyId, role: 'milo', text: delta, mood: moodRef.current },
            ]);
          } else {
            setMessages((prev) =>
              prev.map((m) => (m.id === replyId ? { ...m, text: m.text + delta } : m)),
            );
          }
        },
        onDone: (detectedMood) => {
          if (!mountedRef.current) return;
          setThinking(false);
          if (!replyStarted) {
            // Stream completed but produced no visible text — treat like
            // any other failure rather than leaving nothing on screen.
            fallBack('api');
            return;
          }
          setFallbackMode(false);
          // Apply any mood shift after the reply that's already showing —
          // it was composed under the mood active when it was sent.
          maybeAutoShiftMood(detectedMood);
        },
        onError: (err) => {
          if (!mountedRef.current) return;
          if (__DEV__) {
            console.log('[Milo] stream failed, falling back:', err.kind, err.message);
          }
          fallBack(err.kind);
        },
      });
    },
    [appendMiloReply, appendInterruptionNote, maybeAutoShiftMood, micListening, toggleMic],
  );

  const handleOrbTap = useCallback(() => {
    Keyboard.dismiss();
    if (micListening) {
      toggleMic();
      const transcript = composerDraft.trim();
      setComposerDraft('');
      if (transcript) handleSend(transcript);
      return;
    }
    setComposerDraft('');
    toggleMic();
  }, [micListening, toggleMic, composerDraft, handleSend]);

  const handleMoodChange = useCallback((next: MoodKey) => {
    if (next === moodRef.current) return;
    lastManualChangeRef.current = Date.now();
    setMood(next);
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: 'system', text: moodShiftLine(next), mood: next },
    ]);
  }, []);

  const handleClearHistory = useCallback(() => {
    Alert.alert(
      'Clear conversation?',
      "This deletes your saved chat history on this device. Can't be undone.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            if (micListening) toggleMic();
            (async () => {
              await clearChatHistory();
              if (!mountedRef.current) return;
              lastManualChangeRef.current = 0;
              moodRef.current = 'steady';
              setMood('steady');
              setFallbackMode(false);
              setComposerDraft('');
              setMessages([freshOpener()]);
            })();
          },
        },
      ],
    );
  }, [micListening, toggleMic]);

  const active = MOODS[mood];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Pressable onPress={() => Keyboard.dismiss()}>
        <View style={styles.header}>
          <Pressable onPress={() => Keyboard.dismiss()} onLongPress={handleClearHistory}>
            <Text style={styles.wordmark}>milo</Text>
          </Pressable>
          <Text
            style={[
              styles.status,
              { color: usingFallback && !thinking ? palette.textMuted : active.accent },
            ]}
          >
            {thinking
              ? 'thinking…'
              : micListening
                ? 'listening…'
                : usingFallback
                  ? 'on autopilot'
                  : 'listening'}
          </Text>
        </View>

        <Animated.View
          style={{
            opacity: keyboardAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
            maxHeight: keyboardAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [ORB_COLLAPSE_HEIGHT, 0],
            }),
            overflow: 'hidden',
          }}
        >
          <Pressable
            style={styles.orbArea}
            onPress={handleOrbTap}
            accessibilityRole="button"
            accessibilityLabel={micListening ? 'Stop voice input and send' : 'Start voice input'}
          >
            <OrbSection mood={mood} energized={thinking || micListening} />
          </Pressable>
        </Animated.View>

        <View style={styles.toggleArea}>
          <MoodToggle
            value={mood}
            onChange={handleMoodChange}
            autoShiftPulseKey={autoShiftPulseKey}
          />
        </View>
      </Pressable>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top}
      >
        <FlatList
          ref={listRef}
          style={styles.list}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => <MessageBubble message={item} />}
          contentContainerStyle={styles.thread}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={scrollToEnd}
          ListFooterComponent={thinking ? <TypingIndicator mood={active} /> : null}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        />

        <View style={{ paddingBottom: insets.bottom }}>
          <Composer
            mood={active}
            value={composerDraft}
            onChangeText={setComposerDraft}
            onSend={handleSend}
            disabled={thinking || !hydrated}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

/** Memoised so appending a message doesn't restart the orb's breathing loop.
 * `energized` drives the same pulse for two distinct situations — Milo
 * composing a reply, or the mic actively listening — since both read as
 * "something dynamic is happening" on the same visual language. */
const OrbSection = memo(function OrbSection({
  mood,
  energized,
}: {
  mood: MoodKey;
  energized: boolean;
}) {
  const moodStyle = MOODS[mood];
  return (
    <>
      <VoiceOrb mood={moodStyle} active={energized} />
      <Text style={styles.tagline}>{moodStyle.tagline}</Text>
    </>
  );
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.bg,
  },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: 8,
    paddingBottom: 4,
  },
  wordmark: {
    color: palette.text,
    fontSize: 21,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  status: {
    fontSize: 12.5,
    letterSpacing: 0.8,
  },
  orbArea: {
    alignItems: 'center',
    paddingTop: 6,
  },
  tagline: {
    color: palette.textMuted,
    fontSize: 12.5,
    letterSpacing: 0.4,
    marginTop: 12,
  },
  toggleArea: {
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 14,
  },
  list: {
    flex: 1,
  },
  thread: {
    paddingTop: 8,
    paddingBottom: 12,
  },
});

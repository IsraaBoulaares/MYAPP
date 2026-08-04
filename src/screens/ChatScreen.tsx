import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
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
import { fetchNikoReply } from '../api/nikoClient';
import Composer from '../components/Composer';
import MessageBubble from '../components/MessageBubble';
import MoodToggle from '../components/MoodToggle';
import TypingIndicator from '../components/TypingIndicator';
import VoiceOrb from '../components/VoiceOrb';
import { fallbackReply, moodShiftLine, opener } from '../data/cannedReplies';
import { MOODS, palette, type MoodKey } from '../theme';
import type { Message } from '../types';

/** Only used for the offline fallback, so its personality still comes through
 * even when Gemini is unreachable — playful answers back fast, soft takes
 * its time. Real API replies land whenever the network resolves. */
const THINK_MS: Record<MoodKey, number> = {
  steady: 1100,
  soft: 1500,
  playful: 700,
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Natural height of the orb + tagline (VoiceOrb's 208px SIZE, plus the
// tagline and its spacing) — the amount of room reclaimed when it collapses.
const ORB_COLLAPSE_HEIGHT = 260;

// A manual tap wins over auto-detection for this long before Niko starts
// reading tone again on its own.
const MANUAL_OVERRIDE_MS = 2 * 60 * 1000;

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const [mood, setMood] = useState<MoodKey>('steady');
  const [thinking, setThinking] = useState(false);
  const [messages, setMessages] = useState<Message[]>(() => [
    { id: 'm-opener', role: 'niko', text: opener('steady'), mood: 'steady' },
  ]);

  const idRef = useRef(0);
  const nextId = () => `m${idRef.current++}`;

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

  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

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

  const appendNikoReply = useCallback((text: string, mood: MoodKey) => {
    setMessages((prev) => [...prev, { id: nextId(), role: 'niko', text, mood }]);
  }, []);

  // Applies a detected mood only if the user hasn't manually overridden it
  // recently — manual choice wins for MANUAL_OVERRIDE_MS before Niko starts
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

  const handleSend = useCallback((text: string) => {
    const moodAtSend = moodRef.current;
    const userMessage: Message = { id: nextId(), role: 'user', text, mood: moodAtSend };
    const historyForApi = [...messagesRef.current, userMessage];

    setMessages((prev) => [...prev, userMessage]);
    setThinking(true);

    (async () => {
      try {
        const { reply, detectedMood } = await fetchNikoReply(moodAtSend, historyForApi);
        if (!mountedRef.current) return;
        // Apply any mood shift first so the reply we're about to show
        // already reflects it, not the following one.
        maybeAutoShiftMood(detectedMood);
        appendNikoReply(reply, moodRef.current);
      } catch {
        // Gemini/Vercel unreachable — fall back to a canned reply so the
        // app still feels alive, with the same mood-dependent pacing. No
        // classification is available offline, so mood doesn't auto-shift.
        const current = moodRef.current;
        await wait(THINK_MS[current]);
        if (!mountedRef.current) return;
        const cursor = fallbackCursor.current[current];
        fallbackCursor.current[current] = cursor + 1;
        appendNikoReply(fallbackReply(current, cursor), current);
      } finally {
        if (mountedRef.current) setThinking(false);
      }
    })();
  }, [appendNikoReply, maybeAutoShiftMood]);

  const handleMoodChange = useCallback((next: MoodKey) => {
    if (next === moodRef.current) return;
    lastManualChangeRef.current = Date.now();
    setMood(next);
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: 'system', text: moodShiftLine(next), mood: next },
    ]);
  }, []);

  const active = MOODS[mood];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Pressable onPress={() => Keyboard.dismiss()}>
        <View style={styles.header}>
          <Text style={styles.wordmark}>niko</Text>
          <Text style={[styles.status, { color: active.accent }]}>
            {thinking ? 'thinking…' : 'listening'}
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
          <View style={styles.orbArea}>
            <OrbSection mood={mood} thinking={thinking} />
          </View>
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
          <Composer mood={active} onSend={handleSend} disabled={thinking} />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

/** Memoised so appending a message doesn't restart the orb's breathing loop. */
const OrbSection = memo(function OrbSection({
  mood,
  thinking,
}: {
  mood: MoodKey;
  thinking: boolean;
}) {
  const active = MOODS[mood];
  return (
    <>
      <VoiceOrb mood={active} active={thinking} />
      <Text style={styles.tagline}>{active.tagline}</Text>
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

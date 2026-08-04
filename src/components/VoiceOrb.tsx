import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { MOODS, MOOD_ORDER, palette, type Mood } from '../theme';

type Props = {
  mood: Mood;
  /** True while Milo is "thinking" — the orb leans in and breathes harder. */
  active?: boolean;
  /** True while the mic is actively listening — the breathing cadence and
   * pulse size react to live volume instead of running on a fixed timer. */
  listening?: boolean;
  /** 0–1 normalized live mic amplitude. Only meaningful while listening;
   * ignored otherwise. */
  volume?: number;
};

const SIZE = 208;
const RINGS = [
  { size: SIZE, opacity: 0.22, delay: 0 },
  { size: SIZE * 0.78, opacity: 0.3, delay: 0.12 },
  { size: SIZE * 0.58, opacity: 0.42, delay: 0.24 },
];
const CORE = SIZE * 0.4;

// At max volume the breathing cadence shrinks to this fraction of its
// normal duration (proportional, not an absolute floor, so playful stays
// "always quick, gets quicker" and steady stays relatively the slowest
// even when reacting to loud speech).
const LISTEN_MIN_CADENCE_FACTOR = 0.45;
// Extra multiplicative size/opacity/lift layered on top of the ongoing
// breath cycle at max volume — this is what makes loud speech look
// "bigger", independent of and faster-reacting than the cadence change.
const VOICE_RING_SCALE_BOOST = 1.18;
const VOICE_RING_OPACITY_BOOST = 1.35;
const VOICE_CORE_SCALE_BOOST = 1.1;
const VOICE_LIFT_BOOST = 1.06;

/**
 * Colour is animated by interpolating across every mood in MOOD_ORDER at once,
 * so switching from any mood to any other is a single smooth sweep rather than
 * a hard cut. Transform/opacity run on the native driver; colour has to run in
 * JS, so the two are kept on separate (nested) views.
 */
export default function VoiceOrb({ mood, active = false, listening = false, volume = 0 }: Props) {
  const breath = useRef(new Animated.Value(0)).current;
  const energy = useRef(new Animated.Value(0)).current;
  const voiceBoost = useRef(new Animated.Value(0)).current;
  const moodPos = useRef(
    new Animated.Value(MOOD_ORDER.indexOf(mood.key)),
  ).current;

  // Latest normalized volume, read only at the start of each breath
  // half-cycle (below) rather than driving it directly — retiming an
  // in-flight Animated.timing mid-flight isn't practical, and adapting at
  // the natural inhale/exhale boundary reads as a genuine cadence change
  // rather than a stutter. The continuous, truly real-time reaction to
  // volume is voiceBoost, driven separately just below.
  const volumeRef = useRef(0);
  useEffect(() => {
    volumeRef.current = listening ? Math.max(0, Math.min(1, volume)) : 0;
  }, [listening, volume]);

  // The breathing loop itself — always running, idle or not. Its per-cycle
  // duration is only reconsidered when the mood or listening state changes
  // structurally; live volume adjusts each new cycle's speed via the ref
  // above, without needing to tear this effect down on every sample.
  useEffect(() => {
    let cancelled = false;
    let current: Animated.CompositeAnimation | null = null;

    const runHalfCycle = (toValue: number) => {
      if (cancelled) return;
      const boost = listening ? volumeRef.current : 0;
      const normalHalf = mood.breathMs / 2;
      const duration = normalHalf * (1 - boost * (1 - LISTEN_MIN_CADENCE_FACTOR));
      current = Animated.timing(breath, {
        toValue,
        duration,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      });
      current.start(({ finished }) => {
        if (finished && !cancelled) runHalfCycle(toValue === 1 ? 0 : 1);
      });
    };

    runHalfCycle(1);
    return () => {
      cancelled = true;
      current?.stop();
    };
  }, [breath, mood.breathMs, listening]);

  // Real-time amplitude reaction, layered on top of the breath cycle above
  // rather than replacing it — this is the "bigger" half of "bigger/faster",
  // while the effect above is the "faster" half. Eases toward 0 (plain idle
  // breathing, no boost) whenever not listening, which is the smooth
  // handoff back to normal on stop.
  useEffect(() => {
    const timing = Animated.timing(voiceBoost, {
      toValue: listening ? Math.max(0, Math.min(1, volume)) : 0,
      duration: listening ? 120 : 260,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    timing.start();
    return () => timing.stop();
  }, [voiceBoost, listening, volume]);

  useEffect(() => {
    Animated.timing(moodPos, {
      toValue: MOOD_ORDER.indexOf(mood.key),
      duration: 520,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // colour interpolation is JS-only
    }).start();
  }, [moodPos, mood.key]);

  useEffect(() => {
    Animated.timing(energy, {
      toValue: active ? 1 : 0,
      duration: active ? 260 : 620,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [energy, active]);

  const colorRange = MOOD_ORDER.map((k) => MOODS[k].accent);
  const accent = moodPos.interpolate({
    inputRange: MOOD_ORDER.map((_, i) => i),
    outputRange: colorRange,
  });

  const voiceScaleBoost = voiceBoost.interpolate({
    inputRange: [0, 1],
    outputRange: [1, VOICE_RING_SCALE_BOOST],
  });
  const voiceOpacityBoost = voiceBoost.interpolate({
    inputRange: [0, 1],
    outputRange: [1, VOICE_RING_OPACITY_BOOST],
  });
  const voiceCoreBoost = voiceBoost.interpolate({
    inputRange: [0, 1],
    outputRange: [1, VOICE_CORE_SCALE_BOOST],
  });
  // "Thinking" and "listening" are mutually exclusive in practice (the mic
  // session is always stopped before a message is sent), so summing them
  // is equivalent to "whichever of the two is currently active".
  const lift = Animated.add(energy, voiceBoost).interpolate({
    inputRange: [0, 1],
    outputRange: [1, VOICE_LIFT_BOOST],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.wrap} pointerEvents="none">
      <Animated.View style={[styles.stack, { transform: [{ scale: lift }] }]}>
        {RINGS.map((ring, i) => {
          // Each ring lags the one outside it, so the pulse reads as a wave
          // travelling outward instead of one flat throb.
          const scale = Animated.multiply(
            breath.interpolate({
              inputRange: [0, 1],
              outputRange: [1 - ring.delay * 0.18, mood.breathScale],
            }),
            voiceScaleBoost,
          );
          const ringOpacity = Animated.multiply(
            Animated.multiply(
              breath.interpolate({
                inputRange: [0, 1],
                outputRange: [ring.opacity, ring.opacity * 0.45],
              }),
              energy.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] }),
            ),
            voiceOpacityBoost,
          );

          return (
            <Animated.View
              key={i}
              style={[
                styles.layer,
                {
                  width: ring.size,
                  height: ring.size,
                  borderRadius: ring.size / 2,
                  opacity: ringOpacity,
                  transform: [{ scale }],
                },
              ]}
            >
              <Animated.View
                style={[
                  StyleSheet.absoluteFill,
                  { borderRadius: ring.size / 2, backgroundColor: accent },
                ]}
              />
            </Animated.View>
          );
        })}

        <Animated.View
          style={[
            styles.layer,
            styles.core,
            {
              transform: [
                {
                  scale: Animated.multiply(
                    breath.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 1 + (mood.breathScale - 1) * 0.45],
                    }),
                    voiceCoreBoost,
                  ),
                },
              ],
            },
          ]}
        >
          <Animated.View
            style={[StyleSheet.absoluteFill, styles.coreFill, { backgroundColor: accent }]}
          />
          <View style={styles.sheen} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stack: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  layer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  core: {
    width: CORE,
    height: CORE,
    borderRadius: CORE / 2,
    // Glow. shadowColor stays static per-render; the rings carry the blend.
    shadowColor: palette.text,
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  coreFill: {
    borderRadius: CORE / 2,
  },
  sheen: {
    position: 'absolute',
    top: CORE * 0.14,
    left: CORE * 0.18,
    width: CORE * 0.34,
    height: CORE * 0.24,
    borderRadius: CORE * 0.17,
    backgroundColor: 'rgba(255,255,255,0.38)',
  },
});

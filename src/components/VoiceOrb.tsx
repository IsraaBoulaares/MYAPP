import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { MOODS, MOOD_ORDER, palette, type Mood } from '../theme';

type Props = {
  mood: Mood;
  /** True while Niko is "thinking" — the orb leans in and breathes harder. */
  active?: boolean;
};

const SIZE = 208;
const RINGS = [
  { size: SIZE, opacity: 0.22, delay: 0 },
  { size: SIZE * 0.78, opacity: 0.3, delay: 0.12 },
  { size: SIZE * 0.58, opacity: 0.42, delay: 0.24 },
];
const CORE = SIZE * 0.4;

/**
 * Colour is animated by interpolating across every mood in MOOD_ORDER at once,
 * so switching from any mood to any other is a single smooth sweep rather than
 * a hard cut. Transform/opacity run on the native driver; colour has to run in
 * JS, so the two are kept on separate (nested) views.
 */
export default function VoiceOrb({ mood, active = false }: Props) {
  const breath = useRef(new Animated.Value(0)).current;
  const energy = useRef(new Animated.Value(0)).current;
  const moodPos = useRef(
    new Animated.Value(MOOD_ORDER.indexOf(mood.key)),
  ).current;

  // Restart the breathing loop whenever the mood changes its cadence.
  useEffect(() => {
    breath.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration: mood.breathMs / 2,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 0,
          duration: mood.breathMs / 2,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breath, mood.breathMs]);

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

  const lift = energy.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });

  return (
    <View style={styles.wrap} pointerEvents="none">
      <Animated.View style={[styles.stack, { transform: [{ scale: lift }] }]}>
        {RINGS.map((ring, i) => {
          // Each ring lags the one outside it, so the pulse reads as a wave
          // travelling outward instead of one flat throb.
          const scale = breath.interpolate({
            inputRange: [0, 1],
            outputRange: [1 - ring.delay * 0.18, mood.breathScale],
          });
          const ringOpacity = Animated.multiply(
            breath.interpolate({
              inputRange: [0, 1],
              outputRange: [ring.opacity, ring.opacity * 0.45],
            }),
            energy.interpolate({ inputRange: [0, 1], outputRange: [1, 1.7] }),
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
                  scale: breath.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, 1 + (mood.breathScale - 1) * 0.45],
                  }),
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

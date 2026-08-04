import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MOODS, MOOD_ORDER, palette, type MoodKey } from '../theme';

type Props = {
  value: MoodKey;
  onChange: (mood: MoodKey) => void;
  /** Bump this to play a brief highlight pulse around the track — used when
   * mood changes via auto-detection rather than a direct tap, so the shift
   * reads as intentional rather than a silent glitch. */
  autoShiftPulseKey?: number;
};

const PAD = 4;

export default function MoodToggle({ value, onChange, autoShiftPulseKey }: Props) {
  const [trackWidth, setTrackWidth] = useState(0);
  const pos = useRef(new Animated.Value(MOOD_ORDER.indexOf(value))).current;

  // Thumb position and colour ride the same value, so they stay in lockstep.
  // Both are JS-driven — translateX can't share a native node with backgroundColor.
  useEffect(() => {
    Animated.timing(pos, {
      toValue: MOOD_ORDER.indexOf(value),
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [pos, value]);

  const pulse = useRef(new Animated.Value(0)).current;
  const isFirstPulse = useRef(true);
  useEffect(() => {
    // Skip the mount run — only real bumps (auto-shifts) should flash.
    if (isFirstPulse.current) {
      isFirstPulse.current = false;
      return;
    }
    pulse.setValue(0);
    Animated.sequence([
      Animated.timing(pulse, {
        toValue: 1,
        duration: 200,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.timing(pulse, {
        toValue: 0,
        duration: 600,
        easing: Easing.in(Easing.quad),
        useNativeDriver: false,
      }),
    ]).start();
  }, [autoShiftPulseKey, pulse]);

  const onLayout = (e: LayoutChangeEvent) =>
    setTrackWidth(e.nativeEvent.layout.width);

  const segment = trackWidth > 0 ? (trackWidth - PAD * 2) / MOOD_ORDER.length : 0;
  const inputRange = MOOD_ORDER.map((_, i) => i);

  return (
    <View>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.pulseGlow,
          {
            opacity: pulse,
            borderColor: MOODS[value].accent,
            transform: [
              { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1.04] }) },
            ],
          },
        ]}
      />
      <View style={styles.track} onLayout={onLayout}>
      {segment > 0 && (
        <Animated.View
          style={[
            styles.thumb,
            {
              width: segment,
              backgroundColor: pos.interpolate({
                inputRange,
                outputRange: MOOD_ORDER.map((k) => MOODS[k].bubble),
              }),
              borderColor: pos.interpolate({
                inputRange,
                outputRange: MOOD_ORDER.map((k) => MOODS[k].accent),
              }),
              transform: [
                {
                  translateX: pos.interpolate({
                    inputRange,
                    outputRange: inputRange.map((i) => i * segment),
                  }),
                },
              ],
            },
          ]}
        />
      )}

      {MOOD_ORDER.map((key) => {
        const selected = key === value;
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            style={styles.segment}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`${MOODS[key].label} mood`}
          >
            <Text
              style={[
                styles.label,
                selected && { color: MOODS[key].accent, fontWeight: '600' },
              ]}
            >
              {MOODS[key].label}
            </Text>
          </Pressable>
        );
      })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pulseGlow: {
    position: 'absolute',
    top: -5,
    left: -5,
    right: -5,
    bottom: -5,
    borderRadius: 18,
    borderWidth: 2,
  },
  track: {
    flexDirection: 'row',
    backgroundColor: palette.surface,
    borderRadius: 14,
    padding: PAD,
    borderWidth: 1,
    borderColor: palette.border,
  },
  thumb: {
    position: 'absolute',
    top: PAD,
    left: PAD,
    bottom: PAD,
    borderRadius: 11,
    borderWidth: 1,
  },
  segment: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: palette.textMuted,
    fontSize: 14,
    letterSpacing: 0.2,
  },
});

import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import type { Mood } from '../theme';

const DOTS = [0, 1, 2];
const STAGGER = 160;
const BEAT = 460;

/** Three dots rippling in sequence while Milo composes a reply. */
export default function TypingIndicator({ mood }: { mood: Mood }) {
  const dots = useRef(DOTS.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    const loops = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * STAGGER),
          Animated.timing(dot, {
            toValue: 1,
            duration: BEAT,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0,
            duration: BEAT,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.delay((DOTS.length - 1 - i) * STAGGER),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [dots]);

  return (
    <View style={styles.row}>
      <View style={[styles.pip, { backgroundColor: mood.accent }]} />
      <View
        style={[
          styles.bubble,
          { backgroundColor: mood.bubble, borderColor: `${mood.accent}44` },
        ]}
      >
        {dots.map((dot, i) => (
          <Animated.View
            key={i}
            style={[
              styles.dot,
              { backgroundColor: mood.accent },
              {
                opacity: dot.interpolate({ inputRange: [0, 1], outputRange: [0.28, 1] }),
                transform: [
                  { scale: dot.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.15] }) },
                ],
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 12,
    paddingHorizontal: 20,
  },
  pip: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 8,
    marginBottom: 12,
  },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 18,
    borderWidth: 1,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginHorizontal: 3,
  },
});

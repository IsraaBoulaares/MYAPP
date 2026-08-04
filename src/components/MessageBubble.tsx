import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { MOODS, palette } from '../theme';
import type { Message } from '../types';

export default function MessageBubble({ message }: { message: Message }) {
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [enter]);

  const animated = {
    opacity: enter,
    transform: [
      { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
    ],
  };

  if (message.role === 'system') {
    return (
      <Animated.View style={[styles.systemRow, animated]}>
        <Text style={styles.systemText}>{message.text}</Text>
      </Animated.View>
    );
  }

  const isUser = message.role === 'user';
  const mood = MOODS[message.mood];

  return (
    <Animated.View
      style={[styles.row, isUser ? styles.rowUser : styles.rowMilo, animated]}
    >
      {!isUser && <View style={[styles.pip, { backgroundColor: mood.accent }]} />}
      <View
        style={[
          styles.bubble,
          isUser
            ? styles.userBubble
            : { backgroundColor: mood.bubble, borderColor: `${mood.accent}44` },
        ]}
      >
        <Text style={[styles.text, !isUser && styles.miloText]}>{message.text}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 12,
    paddingHorizontal: 20,
  },
  rowUser: { justifyContent: 'flex-end' },
  rowMilo: { justifyContent: 'flex-start' },
  pip: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 8,
    marginBottom: 12,
  },
  bubble: {
    maxWidth: '78%',
    paddingHorizontal: 15,
    paddingVertical: 11,
    borderRadius: 18,
    borderWidth: 1,
  },
  userBubble: {
    backgroundColor: palette.userBubble,
    borderColor: palette.border,
    borderBottomRightRadius: 6,
  },
  text: {
    color: palette.text,
    fontSize: 15.5,
    lineHeight: 22,
  },
  miloText: {
    // Milo's own words sit a touch softer than the user's.
    color: '#DDE1EE',
  },
  systemRow: {
    alignItems: 'center',
    marginBottom: 14,
    paddingHorizontal: 20,
  },
  systemText: {
    color: palette.textMuted,
    fontSize: 12.5,
    fontStyle: 'italic',
    letterSpacing: 0.2,
  },
});

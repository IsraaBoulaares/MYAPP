import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { palette, type Mood } from '../theme';

type Props = {
  mood: Mood;
  onSend: (text: string) => void;
  disabled?: boolean;
};

export default function Composer({ mood, onSend, disabled = false }: Props) {
  const [draft, setDraft] = useState('');
  const canSend = draft.trim().length > 0 && !disabled;

  const send = () => {
    if (!canSend) return;
    onSend(draft.trim());
    setDraft('');
  };

  return (
    <View style={styles.wrap}>
      <TextInput
        style={styles.input}
        value={draft}
        onChangeText={setDraft}
        placeholder="Talk to Niko…"
        placeholderTextColor={palette.textMuted}
        multiline
        maxLength={500}
        onSubmitEditing={send}
        blurOnSubmit={false}
        returnKeyType="send"
        accessibilityLabel="Message Niko"
      />
      <Pressable
        onPress={send}
        disabled={!canSend}
        accessibilityRole="button"
        accessibilityLabel="Send message"
        accessibilityState={{ disabled: !canSend }}
        style={({ pressed }) => [
          styles.send,
          {
            backgroundColor: canSend ? mood.accent : palette.surfaceRaised,
            opacity: pressed && canSend ? 0.75 : 1,
          },
        ]}
      >
        <Text style={[styles.sendGlyph, { color: canSend ? palette.bg : palette.textMuted }]}>
          ↑
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    backgroundColor: palette.bg,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 11,
    color: palette.text,
    fontSize: 15.5,
    lineHeight: 21,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendGlyph: {
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 23,
  },
});

/**
 * Niko's visual language.
 *
 * Everything mood-dependent lives in MOODS so a mood switch is a single
 * lookup — the orb, the accents and the reply cadence all read from here.
 */

export type MoodKey = 'steady' | 'soft' | 'playful';

export const palette = {
  bg: '#0B0D14',
  surface: '#151826',
  surfaceRaised: '#1D2133',
  border: '#252A3D',
  text: '#ECEEF5',
  textMuted: '#8A90A6',
  userBubble: '#242942',
};

export type Mood = {
  key: MoodKey;
  label: string;
  /** Core orb colour and primary accent. */
  accent: string;
  /** Translucent halo layered around the orb. */
  halo: string;
  /** Tint behind Niko's message bubbles. */
  bubble: string;
  /** One full breath of the orb, in ms. Slower = calmer. */
  breathMs: number;
  /** How far the orb swells at the top of a breath. 1 = no movement. */
  breathScale: number;
  /** Shown under the orb so the mood reads as a personality, not a colour. */
  tagline: string;
};

export const MOODS: Record<MoodKey, Mood> = {
  steady: {
    key: 'steady',
    label: 'Steady',
    accent: '#5B8DEF',
    halo: 'rgba(91, 141, 239, 0.16)',
    bubble: 'rgba(91, 141, 239, 0.13)',
    breathMs: 3200,
    breathScale: 1.1,
    tagline: 'grounded · even · here for the long one',
  },
  soft: {
    key: 'soft',
    label: 'Soft',
    accent: '#A78BFA',
    halo: 'rgba(167, 139, 250, 0.16)',
    bubble: 'rgba(167, 139, 250, 0.13)',
    breathMs: 4600,
    breathScale: 1.07,
    tagline: 'gentle · unhurried · no pressure',
  },
  playful: {
    key: 'playful',
    label: 'Playful',
    accent: '#FBBF24',
    halo: 'rgba(251, 191, 36, 0.18)',
    bubble: 'rgba(251, 191, 36, 0.13)',
    breathMs: 1500,
    breathScale: 1.18,
    tagline: 'bright · quick · slightly caffeinated',
  },
};

export const MOOD_ORDER: MoodKey[] = ['steady', 'soft', 'playful'];

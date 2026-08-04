import type { MoodKey } from './theme';

export type Role = 'user' | 'milo' | 'system';

export type Message = {
  id: string;
  role: Role;
  text: string;
  /** Mood Milo was in when this was said — past bubbles keep their colour. */
  mood: MoodKey;
};

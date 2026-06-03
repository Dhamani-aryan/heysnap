/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#1b1b1b',
    background: '#fcfcfd',
    backgroundElement: '#ffffff',
    backgroundSelected: '#f6f6f7',
    textSecondary: '#5d5d5f',
    heading: '#1b1b1b',
    input: '#ffffff',
    inputForeground: '#1b1b1b',
    placeholder: '#a0a1a2',
    secondaryHover: '#f6f6f7',
    border: '#e8e8e8',
    failure: '#e5484d',
  },
  dark: {
    text: '#ffffff',
    background: '#0f0f10',
    backgroundElement: '#171718',
    backgroundSelected: '#262628',
    textSecondary: '#949496',
    heading: '#ffffff',
    input: '#171718',
    inputForeground: '#e4e4e7',
    placeholder: '#5a5b5d',
    secondaryHover: '#262628',
    border: '#1f2021',
    failure: '#e5484d',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

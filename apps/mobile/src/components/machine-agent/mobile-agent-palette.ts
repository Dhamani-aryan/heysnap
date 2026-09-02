export type MobileAgentPalette = {
  background: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  errorText: string;
  codeBackground: string;
};

export const mobileAgentPalettes: Record<'light' | 'dark', MobileAgentPalette> = {
  light: {
    background: '#ffffff',
    surface: '#f7f7f7',
    surfaceMuted: '#eeeeee',
    border: 'rgba(0,0,0,0.08)',
    textPrimary: 'rgba(0,0,0,0.86)',
    textSecondary: 'rgba(0,0,0,0.58)',
    textMuted: 'rgba(0,0,0,0.4)',
    accent: '#0a84ff',
    errorText: '#c13e3e',
    codeBackground: '#f1f3f5',
  },
  dark: {
    background: '#000000',
    surface: '#19191B',
    surfaceMuted: '#262626',
    border: 'rgba(255,255,255,0.08)',
    textPrimary: 'rgba(255,255,255,0.92)',
    textSecondary: 'rgba(255,255,255,0.62)',
    textMuted: 'rgba(255,255,255,0.4)',
    accent: '#0a84ff',
    errorText: '#ff8a8a',
    codeBackground: '#0d0d12',
  },
};

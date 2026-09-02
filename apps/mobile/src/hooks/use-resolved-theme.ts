import { useColorScheme } from 'react-native';

export type ResolvedTheme = 'light' | 'dark';

export function useResolvedTheme(): ResolvedTheme {
  const systemTheme = useColorScheme();

  return systemTheme === 'dark' ? 'dark' : 'light';
}

/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';
import { useResolvedTheme } from '@/hooks/use-resolved-theme';

export function useTheme() {
  const theme = useResolvedTheme();

  return Colors[theme];
}

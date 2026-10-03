import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

const emptySubscribe = () => () => {};

/**
 * Static render stays on light until the client hydrates.
 * useSyncExternalStore is the hydration signal, so this hook does not set state in an effect.
 */
export function useColorScheme() {
  const hasHydrated = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  const colorScheme = useRNColorScheme();
  if (hasHydrated) return colorScheme;
  return 'light';
}

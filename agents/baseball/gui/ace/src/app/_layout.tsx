import { router, Slot, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ReportProvider } from '@/state/report-state';
import { palette } from '@/theme/palette';

SplashScreen.preventAutoHideAsync();

const tabs = [
  { href: '/', label: 'Game' },
  { href: '/report', label: 'Report' },
  { href: '/player', label: 'Player' },
] as const;

function pathSelected(pathname: string, href: string): boolean {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return path === href;
}

export default function RootLayout() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => undefined);
  }, []);

  return (
    <ReportProvider>
      <StatusBar style="light" />
      <View style={{ flex: 1, backgroundColor: palette.field }}>
        <View style={{ flex: 1 }}>
          <Slot />
        </View>
        <View
          style={{
            flexDirection: 'row',
            backgroundColor: palette.tab,
            borderTopWidth: 1,
            borderTopColor: palette.line,
            paddingBottom: insets.bottom,
          }}
        >
          {tabs.map((tab) => {
            const selected = pathSelected(pathname, tab.href);
            return (
              <Pressable
                key={tab.href}
                accessibilityRole="tab"
                accessibilityLabel={tab.label}
                accessibilityState={{ selected }}
                testID={`tab-${tab.label.toLowerCase()}`}
                onPress={() => router.push(tab.href)}
                style={{
                  flex: 1,
                  paddingVertical: 14,
                  alignItems: 'center',
                  borderTopWidth: 2,
                  borderTopColor: selected ? palette.mark : 'transparent',
                }}
              >
                <Text
                  style={{
                    color: selected ? palette.mark : palette.muted,
                    fontSize: 14,
                    fontWeight: '700',
                  }}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </ReportProvider>
  );
}

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { SessionProvider } from '../lib/session.tsx';
import { colour } from '../theme.ts';

/**
 * The shell.
 *
 * One dark header across the app, matching the website's masthead, so the two
 * read as the same product. Light status bar because the header behind it is
 * the deep green.
 */
export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colour.primary },
          headerTintColor: colour.cream,
          headerTitleStyle: { color: colour.cream },
          contentStyle: { backgroundColor: colour.sand },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Rare Minting' }} />
        <Stack.Screen name="listing/[id]" options={{ title: 'Note' }} />
        <Stack.Screen name="cart" options={{ title: 'Your cart' }} />
        <Stack.Screen name="sign-in" options={{ title: 'Sign in' }} />
        <Stack.Screen name="address" options={{ title: 'Delivery address' }} />
      </Stack>
    </SessionProvider>
  );
}

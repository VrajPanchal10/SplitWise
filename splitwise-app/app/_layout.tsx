import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { ActivityIndicator, View } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { BillCreationProvider } from '../context/BillCreationContext';

import { useEffect } from 'react';
import * as SplashScreen from 'expo-splash-screen';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

function RootLayoutContent() {
  const { isLoading, isAuthenticated } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading) {
      SplashScreen.hideAsync();
    }
  }, [isLoading]);

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [isLoading, isAuthenticated, segments]);

  // Keep rendering null until loading is complete to preserve the native splash screen.
  // After loading, we render a single unified stack.
  if (isLoading) {
    return null;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="group/[id]" />
      <Stack.Screen name="friend/[id]" />
      <Stack.Screen name="bill/[id]" />
      <Stack.Screen name="add-bill" />
      <Stack.Screen name="manual-entry" />
      <Stack.Screen name="edit-profile" />
      <Stack.Screen name="scan-bill" />
      <Stack.Screen name="select-expense-type" />
      <Stack.Screen name="select-items" />
      <Stack.Screen name="split-summary" />
      <Stack.Screen name="settlement" />
      <Stack.Screen name="add-group" />
      <Stack.Screen name="qr-code" />
      <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <BillCreationProvider>
          <RootLayoutContent />
        </BillCreationProvider>
        <StatusBar style="auto" />
      </AuthProvider>
    </ThemeProvider>
  );
}
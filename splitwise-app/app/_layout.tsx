import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { ActivityIndicator, View } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { BillCreationProvider } from '../context/BillCreationContext';

export const unstable_settings = {
  anchor: '(tabs)',
};

function RootLayoutContent() {
  const colorScheme = useColorScheme();
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // Conditional rendering based on auth state
  if (isAuthenticated) {
    return (
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="group/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="friend/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="bill/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="add-bill" options={{ headerShown: false }} />
        <Stack.Screen name="manual-entry" options={{ headerShown: false }} />
        <Stack.Screen name="edit-profile" options={{ headerShown: false }} />
        <Stack.Screen name="scan-bill" options={{ headerShown: false }} />
        <Stack.Screen name="select-expense-type" options={{ headerShown: false }} />
        <Stack.Screen name="select-items" options={{ headerShown: false }} />
        <Stack.Screen name="split-summary" options={{ headerShown: false }} />
        <Stack.Screen name="settlement" options={{ headerShown: false }} />
        <Stack.Screen name="add-group" options={{ headerShown: false }} />
        <Stack.Screen name="qr-code" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', headerShown: false }} />
      </Stack>
    );
  }

  return (
    <Stack>
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="group/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="friend/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="bill/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="add-bill" options={{ headerShown: false }} />
      <Stack.Screen name="manual-entry" options={{ headerShown: false }} />
      <Stack.Screen name="edit-profile" options={{ headerShown: false }} />
      <Stack.Screen name="scan-bill" options={{ headerShown: false }} />
      <Stack.Screen name="select-expense-type" options={{ headerShown: false }} />
      <Stack.Screen name="select-items" options={{ headerShown: false }} />
      <Stack.Screen name="split-summary" options={{ headerShown: false }} />
      <Stack.Screen name="settlement" options={{ headerShown: false }} />
      <Stack.Screen name="add-group" options={{ headerShown: false }} />
      <Stack.Screen name="qr-code" options={{ headerShown: false }} />
      <Stack.Screen name="modal" options={{ presentation: 'modal', headerShown: false }} />
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
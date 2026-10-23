import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../auth/AuthContext';
import { AppDataProvider } from '../state/AppData';
import { Loading } from '../ui/components';
import { colors } from '../ui/theme';

function RootNavigator() {
  const { status } = useAuth();
  if (status === 'loading') return <Loading />;
  const signedIn = status === 'signedIn';
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: '#FFFFFF',
        headerTitleStyle: { fontWeight: '800' },
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="report-new" options={{ title: 'Neuer Tätigkeitsbericht', presentation: 'modal' }} />
        <Stack.Screen name="sick-note" options={{ title: 'Krankmeldung', presentation: 'modal' }} />
        <Stack.Screen name="correction-request" options={{ title: 'Korrektur beantragen', presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="invite" options={{ title: 'Einladung annehmen' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AuthProvider>
        <AppDataProvider>
          <RootNavigator />
        </AppDataProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

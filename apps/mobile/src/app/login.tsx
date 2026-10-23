import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth/AuthContext';
import { errorMessage } from '../api/client';
import { Button, Card, Field, Notice } from '../ui/components';
import { colors, space } from '../ui/theme';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.primary }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'center', padding: space.md }}>
        <View style={{ alignItems: 'center', marginBottom: space.lg, gap: space.sm }}>
          <View style={{ backgroundColor: colors.accent, borderRadius: 20, padding: 14 }}>
            <Ionicons name="construct" size={40} color="#FFFFFF" />
          </View>
          <Text style={{ color: '#FFFFFF', fontSize: 30, fontWeight: '900' }}>Rheinraum</Text>
          <Text style={{ color: '#D6E2F0', fontSize: 17 }}>Zeiterfassung für die Baustelle</Text>
        </View>
        <Card style={{ gap: space.md }}>
          <Field label="E-Mail" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" />
          <Field label="Passwort" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" onSubmitEditing={submit} />
          {error && <Notice tone="danger">{error}</Notice>}
          <Button title="Anmelden" icon="log-in" onPress={submit} loading={busy} disabled={!email || !password} big />
          <Button title="Einladungscode einlösen" variant="ghost" onPress={() => router.push('/invite')} />
        </Card>
        <Text style={{ color: '#D6E2F0', textAlign: 'center', marginTop: space.md, fontSize: 14 }}>
          Zugänge werden von Ihrer Firma angelegt.
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
